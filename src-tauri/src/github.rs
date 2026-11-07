//! GitHub.com integration for authenticated repository browsing and cloning.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use git2::Repository;
use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "git-gui-client";
const KEYRING_TOKEN_USER: &str = "github-token";
const API_URL: &str = "https://api.github.com";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSettingsView {
    pub has_token: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct GitHubRepository {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub clone_url: String,
    pub private: bool,
}

fn token_get() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_TOKEN_USER)
        .ok()?
        .get_password()
        .ok()
        .filter(|token| !token.is_empty())
}

fn token_set(token: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_TOKEN_USER)
        .map_err(|error| format!("keyring unavailable: {error}"))?
        .set_password(token)
        .map_err(|error| format!("could not store token in keyring: {error}"))
}

fn token_delete() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_TOKEN_USER) {
        let _ = entry.delete_password();
    }
}

pub fn settings_view() -> GitHubSettingsView {
    GitHubSettingsView {
        has_token: token_get().is_some(),
    }
}

/// `Some("")` clears the token; `None` leaves it unchanged.
pub fn save_settings(token: Option<String>) -> Result<(), String> {
    match token.as_deref().map(str::trim) {
        Some("") => token_delete(),
        Some(token) => token_set(token)?,
        None => {}
    }
    Ok(())
}

pub fn clear_settings() {
    token_delete();
}

pub fn token_for_test(provided: Option<String>) -> Option<String> {
    provided
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
        .or_else(token_get)
}

pub fn test_connection(token: &str) -> Result<String, String> {
    let response = ureq::get(&format!("{API_URL}/user"))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .call()
        .map_err(|error| format!("GitHub connection failed: {error}"))?;
    let body = response
        .into_string()
        .map_err(|error| format!("could not read GitHub user response: {error}"))?;
    let user: serde_json::Value = serde_json::from_str(&body)
        .map_err(|error| format!("unexpected GitHub user response: {error}"))?;
    user.get("login")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "GitHub response did not contain a username".to_string())
}

pub fn list_repositories(page: u32) -> Result<Vec<GitHubRepository>, String> {
    if page == 0 {
        return Err("GitHub repository page must be greater than zero".to_string());
    }
    let token =
        token_get().ok_or_else(|| "GitHub personal access token is not configured".to_string())?;
    let url = format!(
        "{API_URL}/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&sort=updated&per_page=100&page={page}"
    );
    let response = ureq::get(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .call()
        .map_err(|error| format!("could not list GitHub repositories: {error}"))?;
    let body = response
        .into_string()
        .map_err(|error| format!("could not read GitHub repository list: {error}"))?;
    serde_json::from_str(&body)
        .map_err(|error| format!("unexpected GitHub repository response: {error}"))
}

fn is_github_https(url: &str) -> bool {
    let Some((scheme, rest)) = url.trim().split_once("://") else {
        return false;
    };
    if !scheme.eq_ignore_ascii_case("https") {
        return false;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    !authority.contains('@') && authority.eq_ignore_ascii_case("github.com")
}

/// Restrict the token header to GitHub.com HTTPS remotes only.
pub fn auth_arg_for_url(url: &str) -> Option<String> {
    if !is_github_https(url) {
        return None;
    }
    let token = token_get()?;
    let credentials = STANDARD.encode(format!("x-access-token:{token}"));
    Some(format!(
        "http.https://github.com/.extraheader=Authorization: Basic {credentials}"
    ))
}

pub fn auth_arg_for_repo(repo: &Repository) -> Option<String> {
    repo.remotes()
        .ok()?
        .iter()
        .flatten()
        .filter_map(|name| repo.find_remote(name).ok())
        .find_map(|remote| remote.url().and_then(auth_arg_for_url))
}

pub fn auth_arg_for_remote(repo: &Repository, remote_name: &str, pushing: bool) -> Option<String> {
    let remote = repo.find_remote(remote_name).ok()?;
    let url = if pushing {
        remote.pushurl().or_else(|| remote.url())
    } else {
        remote.url()
    }?;
    auth_arg_for_url(url)
}

#[cfg(test)]
mod tests {
    use super::{auth_arg_for_url, is_github_https, GitHubRepository};

    #[test]
    fn limits_pat_auth_to_github_com_https() {
        assert!(is_github_https("https://github.com/org/repo.git"));
        assert!(!is_github_https("http://github.com/org/repo.git"));
        assert!(!is_github_https("https://github.example.com/org/repo.git"));
        assert!(!is_github_https("https://user@github.com/org/repo.git"));
        assert!(auth_arg_for_url("https://example.com/org/repo.git").is_none());
    }

    #[test]
    fn deserializes_repository_api_fields() {
        let repository: GitHubRepository = serde_json::from_str(
            r#"{"id":7,"name":"repo","full_name":"org/repo","description":null,"clone_url":"https://github.com/org/repo.git","private":true}"#,
        )
        .unwrap();
        assert_eq!(repository.full_name, "org/repo");
        assert_eq!(repository.clone_url, "https://github.com/org/repo.git");
        assert!(repository.private);
    }
}
