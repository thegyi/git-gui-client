//! Self-hosted GitLab integration.
//!
//! Non-secret settings (URL, username) live in `gitlab.json` inside the app
//! config dir. The API token is stored in the OS keyring — never on disk.
//! When a repo has a remote whose host matches the configured GitLab URL,
//! fetch/pull/push automatically authenticate with HTTP Basic auth
//! (username + PAT as password), scoped to that host only.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use git2::Repository;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

const KEYRING_SERVICE: &str = "git-gui-client";
const KEYRING_TOKEN_USER: &str = "gitlab-token";
const SETTINGS_FILE: &str = "gitlab.json";

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitlabFileConfig {
    pub url: String,
    pub username: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitlabSettingsView {
    pub url: String,
    pub username: String,
    pub has_token: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct GitlabProject {
    pub id: u64,
    pub name: String,
    pub path_with_namespace: String,
    pub description: Option<String>,
    pub http_url_to_repo: String,
    pub web_url: String,
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(SETTINGS_FILE))
}

/// Public read of the non-secret settings file (used for repo matching).
pub fn load_file_pub(app: &tauri::AppHandle) -> GitlabFileConfig {
    load_file(app)
}

fn load_file(app: &tauri::AppHandle) -> GitlabFileConfig {
    let Ok(path) = settings_path(app) else {
        return GitlabFileConfig::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_file(app: &tauri::AppHandle, cfg: &GitlabFileConfig) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn token_get() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_TOKEN_USER)
        .ok()?
        .get_password()
        .ok()
        .filter(|t| !t.is_empty())
}

fn token_set(token: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_TOKEN_USER)
        .map_err(|e| format!("keyring unavailable: {e}"))?
        .set_password(token)
        .map_err(|e| format!("could not store token in keyring: {e}"))
}

fn token_delete() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_TOKEN_USER) {
        let _ = entry.delete_password();
    }
}

// ---------------------------------------------------------------------------
// Public API used by commands
// ---------------------------------------------------------------------------

pub fn settings_view(app: &tauri::AppHandle) -> GitlabSettingsView {
    let cfg = load_file(app);
    GitlabSettingsView {
        url: cfg.url,
        username: cfg.username,
        has_token: token_get().is_some(),
    }
}

/// `token`: `Some("")` deletes the stored token, `Some(t)` stores it,
/// `None` leaves it unchanged.
pub fn save_settings(
    app: &tauri::AppHandle,
    url: &str,
    username: &str,
    token: Option<String>,
) -> Result<(), String> {
    let url = normalize_url(url);
    if !url.is_empty() && authority_of(&url).is_none() {
        return Err("GitLab URL must be a valid http(s) URL".to_string());
    }
    let cfg = GitlabFileConfig {
        url,
        username: username.trim().to_string(),
    };
    match token.as_deref().map(str::trim) {
        Some("") => token_delete(),
        Some(t) => token_set(t)?,
        None => {}
    }
    save_file(app, &cfg)
}

pub fn clear_settings(app: &tauri::AppHandle) -> Result<(), String> {
    token_delete();
    if let Ok(path) = settings_path(app) {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

pub fn token_for_test(provided: Option<String>) -> Option<String> {
    provided
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .or_else(token_get)
}

pub fn list_projects(app: &tauri::AppHandle, page: u32) -> Result<Vec<GitlabProject>, String> {
    if page == 0 {
        return Err("GitLab project page must be greater than zero".to_string());
    }
    let cfg = load_file(app);
    if cfg.url.is_empty() {
        return Err("GitLab server is not configured".to_string());
    }
    let token = token_get().ok_or_else(|| "GitLab API token is not configured".to_string())?;
    let url = format!(
        "{}/api/v4/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at&sort=desc&page={page}",
        normalize_url(&cfg.url)
    );
    let response = ureq::get(&url)
        .set("PRIVATE-TOKEN", &token)
        .call()
        .map_err(|e| format!("could not list GitLab projects: {e}"))?;
    let body = response
        .into_string()
        .map_err(|e| format!("could not read GitLab project list: {e}"))?;
    serde_json::from_str(&body).map_err(|e| format!("unexpected GitLab project response: {e}"))
}

// ---------------------------------------------------------------------------
// Matching & auth
// ---------------------------------------------------------------------------

/// Normalize a URL: trim, default to https:// when no scheme, drop trailing slash.
pub fn normalize_url(url: &str) -> String {
    let u = url.trim().trim_end_matches('/');
    if u.is_empty() {
        return String::new();
    }
    if u.contains("://") {
        u.to_string()
    } else {
        format!("https://{u}")
    }
}

/// Lowercased `scheme://authority` host[:port] of an http(s) URL.
/// Returns None for SSH-style (`git@host:path`) or invalid URLs.
pub fn authority_of(url: &str) -> Option<String> {
    let u = normalize_url(url);
    let rest = u.split("://").nth(1)?;
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .filter(|a| !a.is_empty())?;
    // Reject userinfo tricks: authority must not contain '@' before host.
    if authority.contains('@') {
        return None;
    }
    Some(authority.to_lowercase())
}

pub fn repo_remote_urls(repo: &Repository) -> Vec<String> {
    repo.remotes()
        .ok()
        .map(|names| {
            names
                .iter()
                .flatten()
                .filter_map(|n| {
                    repo.find_remote(n)
                        .ok()
                        .and_then(|r| r.url().map(|u| u.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Does any of the repo's http(s) remotes point at the configured GitLab host?
pub fn repo_uses_gitlab(repo: &Repository, gitlab_url: &str) -> bool {
    let Some(want) = authority_of(gitlab_url) else {
        return false;
    };
    repo_remote_urls(repo)
        .iter()
        .any(|u| authority_of(u).as_deref() == Some(want.as_str()))
}

/// If the repo matches the configured GitLab and a token is stored, returns
/// a `-c` git config argument that injects HTTP Basic auth scoped to that
/// host only (other remotes are unaffected).
pub fn auth_arg_for_repo(repo: &Repository, cfg: &GitlabFileConfig) -> Option<String> {
    if cfg.url.is_empty() {
        return None;
    }
    let matching_url = repo_remote_urls(repo)
        .into_iter()
        .find(|url| authority_of(url) == authority_of(&cfg.url))?;
    auth_arg_for_url(&matching_url, cfg)
}

pub fn auth_arg_for_remote(
    repo: &Repository,
    remote_name: &str,
    pushing: bool,
    cfg: &GitlabFileConfig,
) -> Option<String> {
    let remote = repo.find_remote(remote_name).ok()?;
    let url = if pushing {
        remote.pushurl().or_else(|| remote.url())
    } else {
        remote.url()
    }?;
    auth_arg_for_url(url, cfg)
}

pub fn auth_arg_for_url(url: &str, cfg: &GitlabFileConfig) -> Option<String> {
    if cfg.url.is_empty() || authority_of(url) != authority_of(&cfg.url) {
        return None;
    }
    let token = token_get()?;
    let username = if cfg.username.is_empty() {
        "gitlab"
    } else {
        cfg.username.as_str()
    };
    let creds = STANDARD.encode(format!("{username}:{token}"));
    let scheme = normalize_url(url).split("://").next()?.to_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let authority = authority_of(url)?;
    Some(format!(
        "http.{scheme}://{authority}.extraheader=Authorization: Basic {creds}"
    ))
}

// ---------------------------------------------------------------------------
// Connection test (GitLab REST API)
// ---------------------------------------------------------------------------

/// Verify a token against `{url}/api/v4/user`. Returns the GitLab username.
pub fn test_connection(base_url: &str, token: &str) -> Result<String, String> {
    let url = format!("{}/api/v4/user", normalize_url(base_url));
    let resp = ureq::get(&url)
        .set("PRIVATE-TOKEN", token)
        .call()
        .map_err(|e| format!("request failed: {e}"))?;
    let body = resp.into_string().map_err(|e| e.to_string())?;
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("unexpected response: {e}"))?;
    v.get("username")
        .and_then(|u| u.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "response did not contain a username".to_string())
}
