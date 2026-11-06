mod git;
mod gitlab;

use git::cli;
use git::*;
use gitlab::GitlabSettingsView;
use std::path::Path;
use tauri::AppHandle;

/// Run blocking git work on the async runtime's blocking pool.
async fn blocking<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("background task failed: {e}"))?
}

// ---------------------------------------------------------------------------
// Read commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn open_repo(app: AppHandle, path: String) -> Result<RepoInfo, String> {
    blocking(move || {
        let repo = open(&path)?;
        let mut info = repo_info(&repo);
        let cfg = gitlab::load_file_pub(&app);
        if !cfg.url.is_empty() {
            info.gitlab_matched = gitlab::repo_uses_gitlab(&repo, &cfg.url);
        }
        Ok(info)
    })
    .await
}

#[tauri::command]
async fn get_status(path: String) -> Result<Vec<FileStatus>, String> {
    blocking(move || {
        let repo = open(&path)?;
        status(&repo)
    })
    .await
}

#[tauri::command]
async fn get_log(path: String, limit: usize) -> Result<Vec<CommitInfo>, String> {
    blocking(move || {
        let repo = open(&path)?;
        log(&repo, limit)
    })
    .await
}

#[tauri::command]
async fn get_branches(path: String) -> Result<Vec<BranchInfo>, String> {
    blocking(move || {
        let repo = open(&path)?;
        branches(&repo)
    })
    .await
}

#[tauri::command]
async fn get_tags(path: String) -> Result<Vec<TagInfo>, String> {
    blocking(move || {
        let repo = open(&path)?;
        tags(&repo)
    })
    .await
}

#[tauri::command]
async fn get_file_diff(path: String, file_path: String, staged: bool) -> Result<FileDiff, String> {
    blocking(move || {
        let repo = open(&path)?;
        workdir_file_diff(&repo, &file_path, staged)
    })
    .await
}

#[tauri::command]
async fn get_commit_file_diff(path: String, hash: String, file_path: String) -> Result<FileDiff, String> {
    blocking(move || {
        let repo = open(&path)?;
        commit_file_diff(&repo, &hash, &file_path)
    })
    .await
}

#[tauri::command]
async fn get_commit_details(path: String, hash: String) -> Result<CommitDetails, String> {
    blocking(move || {
        let repo = open(&path)?;
        commit_details(&repo, &hash)
    })
    .await
}

// ---------------------------------------------------------------------------
// Mutation commands (git CLI)
// ---------------------------------------------------------------------------

#[tauri::command]
async fn stage_files(path: String, files: Vec<String>) -> Result<(), String> {
    blocking(move || cli::stage_files(Path::new(&path), &files)).await
}

#[tauri::command]
async fn unstage_files(path: String, files: Vec<String>) -> Result<(), String> {
    blocking(move || cli::unstage_files(Path::new(&path), &files)).await
}

#[tauri::command]
async fn stage_all(path: String) -> Result<(), String> {
    blocking(move || cli::stage_all(Path::new(&path))).await
}

#[tauri::command]
async fn unstage_all(path: String) -> Result<(), String> {
    blocking(move || cli::unstage_all(Path::new(&path))).await
}

#[tauri::command]
async fn commit(path: String, message: String, amend: bool) -> Result<String, String> {
    blocking(move || cli::commit(Path::new(&path), &message, amend)).await
}

#[tauri::command]
async fn checkout_branch(path: String, name: String) -> Result<(), String> {
    blocking(move || cli::checkout_branch(Path::new(&path), &name)).await
}

#[tauri::command]
async fn create_branch(path: String, name: String, checkout: bool) -> Result<(), String> {
    blocking(move || cli::create_branch(Path::new(&path), &name, checkout)).await
}

#[tauri::command]
async fn delete_branch(path: String, name: String) -> Result<(), String> {
    blocking(move || cli::delete_branch(Path::new(&path), &name)).await
}

#[tauri::command]
async fn create_tag(path: String, name: String, message: Option<String>) -> Result<(), String> {
    blocking(move || cli::create_tag(Path::new(&path), &name, message)).await
}

#[tauri::command]
async fn delete_tag(path: String, name: String) -> Result<(), String> {
    blocking(move || cli::delete_tag(Path::new(&path), &name)).await
}

/// Resolve the `-c` auth arg for remote ops: only when the repo's remote
/// matches the configured GitLab AND a token is stored.
fn gitlab_auth_arg(app: &AppHandle, repo: &git2::Repository) -> Option<String> {
    let cfg = gitlab::load_file_pub(app);
    gitlab::auth_arg_for_repo(repo, &cfg)
}

#[tauri::command]
async fn git_fetch(app: AppHandle, path: String) -> Result<String, String> {
    blocking(move || {
        let repo = open(&path)?;
        let auth = gitlab_auth_arg(&app, &repo);
        cli::fetch_all(Path::new(&path), auth.as_deref())
    })
    .await
}

#[tauri::command]
async fn git_pull(app: AppHandle, path: String) -> Result<String, String> {
    blocking(move || {
        let repo = open(&path)?;
        let auth = gitlab_auth_arg(&app, &repo);
        cli::pull(Path::new(&path), auth.as_deref())
    })
    .await
}

#[tauri::command]
async fn git_push(app: AppHandle, path: String) -> Result<String, String> {
    blocking(move || {
        let repo = open(&path)?;
        let auth = gitlab_auth_arg(&app, &repo);
        cli::push(Path::new(&path), auth.as_deref())
    })
    .await
}

// ---------------------------------------------------------------------------
// GitLab settings commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn get_gitlab_settings(app: AppHandle) -> Result<GitlabSettingsView, String> {
    blocking(move || Ok(gitlab::settings_view(&app))).await
}

#[tauri::command]
async fn save_gitlab_settings(
    app: AppHandle,
    url: String,
    username: String,
    token: Option<String>,
) -> Result<(), String> {
    blocking(move || gitlab::save_settings(&app, &url, &username, token)).await
}

#[tauri::command]
async fn clear_gitlab_settings(app: AppHandle) -> Result<(), String> {
    blocking(move || gitlab::clear_settings(&app)).await
}

#[tauri::command]
async fn test_gitlab_connection(
    url: String,
    token: Option<String>,
) -> Result<String, String> {
    blocking(move || {
        let tok = gitlab::token_for_test(token)
            .ok_or_else(|| "no token provided and none stored".to_string())?;
        gitlab::test_connection(&url, &tok)
    })
    .await
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_repo,
            get_status,
            get_log,
            get_branches,
            get_tags,
            get_file_diff,
            get_commit_file_diff,
            get_commit_details,
            stage_files,
            unstage_files,
            stage_all,
            unstage_all,
            commit,
            checkout_branch,
            create_branch,
            delete_branch,
            create_tag,
            delete_tag,
            git_fetch,
            git_pull,
            git_push,
            get_gitlab_settings,
            save_gitlab_settings,
            clear_gitlab_settings,
            test_gitlab_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
