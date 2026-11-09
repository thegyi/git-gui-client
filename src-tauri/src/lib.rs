mod git;
mod github;
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
        if repo.is_bare() {
            return Ok(vec![]);
        }
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
async fn get_older_log(path: String, after: String, limit: usize) -> Result<Vec<CommitInfo>, String> {
    blocking(move || {
        let repo = open(&path)?;
        log_after(&repo, &after, limit)
    })
    .await
}

#[tauri::command]
async fn compare_branches(
    path: String,
    base: String,
    compare: String,
) -> Result<BranchComparison, String> {
    blocking(move || {
        let repo = open(&path)?;
        git::compare_branches(&repo, &base, &compare)
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
async fn get_remotes(path: String) -> Result<Vec<RemoteInfo>, String> {
    blocking(move || {
        let repo = open(&path)?;
        remotes(&repo)
    })
    .await
}

#[tauri::command]
async fn get_worktrees(path: String) -> Result<Vec<WorktreeInfo>, String> {
    blocking(move || cli::worktrees(Path::new(&path))).await
}

#[tauri::command]
async fn get_reflog(path: String, limit: usize) -> Result<Vec<cli::ReflogEntry>, String> {
    blocking(move || cli::reflog(Path::new(&path), limit)).await
}

#[tauri::command]
async fn get_file_history(
    path: String,
    file_path: String,
    limit: usize,
) -> Result<Vec<cli::FileHistoryCommit>, String> {
    blocking(move || cli::file_history(Path::new(&path), &file_path, limit)).await
}

#[tauri::command]
async fn get_file_blame(path: String, file_path: String) -> Result<Vec<cli::BlameLine>, String> {
    blocking(move || cli::file_blame(Path::new(&path), &file_path)).await
}

#[tauri::command]
async fn search_commits(
    path: String,
    query: Option<String>,
    author: Option<String>,
    since: Option<String>,
    until: Option<String>,
    file_path: Option<String>,
    limit: usize,
) -> Result<Vec<CommitInfo>, String> {
    blocking(move || {
        let repo = open(&path)?;
        git::search_commits(
            &repo,
            query.as_deref(),
            author.as_deref(),
            since.as_deref(),
            until.as_deref(),
            file_path.as_deref(),
            limit,
        )
    })
    .await
}

#[tauri::command]
async fn get_bisect_state(path: String) -> Result<cli::BisectState, String> {
    blocking(move || cli::bisect_state(Path::new(&path))).await
}

#[tauri::command]
async fn get_submodules(path: String) -> Result<Vec<SubmoduleInfo>, String> {
    blocking(move || {
        let repo = open(&path)?;
        submodules(&repo)
    })
    .await
}

#[tauri::command]
async fn update_submodule(path: String, submodule_path: String) -> Result<String, String> {
    blocking(move || cli::update_submodule(Path::new(&path), &submodule_path)).await
}

#[tauri::command]
async fn bisect_start(path: String, good_commit: String) -> Result<String, String> {
    blocking(move || cli::bisect_start(Path::new(&path), &good_commit)).await
}

#[tauri::command]
async fn bisect_mark(path: String, good: bool) -> Result<String, String> {
    blocking(move || cli::bisect_mark(Path::new(&path), good)).await
}

#[tauri::command]
async fn bisect_reset(path: String) -> Result<String, String> {
    blocking(move || cli::bisect_reset(Path::new(&path))).await
}

#[tauri::command]
async fn get_review_link(
    app: AppHandle,
    path: String,
    remote: String,
    branch: String,
) -> Result<gitlab::ReviewLink, String> {
    blocking(move || {
        let repo = open(&path)?;
        let remote = repo
            .find_remote(&remote)
            .map_err(|error| error.to_string())?;
        let url = remote
            .url()
            .ok_or_else(|| "selected remote has no fetch URL".to_string())?;
        let cfg = gitlab::load_file_pub(&app);
        gitlab::review_link(url, &branch, &cfg)
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
async fn get_remote_tags(
    app: AppHandle,
    path: String,
    remote: String,
) -> Result<Vec<String>, String> {
    blocking(move || {
        let repo = open(&path)?;
        let auth = remote_auth_arg(&app, &repo, Some(&remote), false);
        cli::remote_tags(Path::new(&path), &remote, auth.as_deref())
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
async fn get_file_hunks(
    path: String,
    file_path: String,
    staged: bool,
) -> Result<Vec<cli::FileHunk>, String> {
    blocking(move || cli::file_hunks(Path::new(&path), &file_path, staged)).await
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
async fn ignore_file(
    path: String,
    file_path: String,
    pattern: String,
    untrack: bool,
) -> Result<(), String> {
    blocking(move || cli::ignore_file(Path::new(&path), &file_path, &pattern, untrack)).await
}

#[tauri::command]
async fn apply_file_hunk(
    path: String,
    file_path: String,
    staged: bool,
    patch: String,
) -> Result<(), String> {
    blocking(move || cli::apply_file_hunk(Path::new(&path), &file_path, staged, &patch)).await
}

#[tauri::command]
async fn discard_worktree_file(path: String, file_path: String) -> Result<(), String> {
    blocking(move || cli::discard_worktree_file(Path::new(&path), &file_path)).await
}

#[tauri::command]
async fn discard_worktree_hunk(
    path: String,
    file_path: String,
    patch: String,
) -> Result<(), String> {
    blocking(move || cli::discard_worktree_hunk(Path::new(&path), &file_path, &patch)).await
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
async fn create_branch(
    path: String,
    name: String,
    checkout: bool,
    commit: Option<String>,
) -> Result<(), String> {
    blocking(move || {
        cli::create_branch(Path::new(&path), &name, checkout, commit.as_deref())
    })
    .await
}

#[tauri::command]
async fn delete_branch(path: String, name: String) -> Result<(), String> {
    blocking(move || cli::delete_branch(Path::new(&path), &name)).await
}

#[tauri::command]
async fn recover_branch_at_commit(path: String, branch: String, commit: String) -> Result<(), String> {
    blocking(move || cli::recover_branch_at_commit(Path::new(&path), &branch, &commit)).await
}

#[tauri::command]
async fn add_worktree(
    path: String,
    worktree_path: String,
    start_point: String,
    new_branch: Option<String>,
) -> Result<(), String> {
    blocking(move || {
        cli::add_worktree(
            Path::new(&path),
            &worktree_path,
            &start_point,
            new_branch.as_deref(),
        )
    })
    .await
}

#[tauri::command]
async fn remove_worktree(path: String, worktree_path: String) -> Result<(), String> {
    blocking(move || cli::remove_worktree(Path::new(&path), &worktree_path)).await
}

#[tauri::command]
async fn add_remote(path: String, name: String, url: String) -> Result<(), String> {
    blocking(move || cli::add_remote(Path::new(&path), &name, &url)).await
}

#[tauri::command]
async fn set_remote_url(path: String, name: String, url: String) -> Result<(), String> {
    blocking(move || cli::set_remote_url(Path::new(&path), &name, &url)).await
}

#[tauri::command]
async fn remove_remote(path: String, name: String) -> Result<(), String> {
    blocking(move || cli::remove_remote(Path::new(&path), &name)).await
}

#[tauri::command]
async fn set_upstream(path: String, branch: String, upstream: Option<String>) -> Result<(), String> {
    blocking(move || cli::set_upstream(Path::new(&path), &branch, upstream.as_deref())).await
}

#[tauri::command]
async fn delete_remote_branch(app: AppHandle, path: String, name: String) -> Result<String, String> {
    blocking(move || {
        let repo = open(&path)?;
        let remote_name = repo.remotes().ok().and_then(|remotes| {
            remotes
                .iter()
                .flatten()
                .filter(|remote| name.starts_with(&format!("{remote}/")))
                .max_by_key(|remote| remote.len())
                .map(str::to_string)
        });
        let auth = remote_auth_arg(&app, &repo, remote_name.as_deref(), true);
        cli::delete_remote_branch(Path::new(&path), &name, auth.as_deref())
    })
    .await
}

#[tauri::command]
async fn create_tag(
    path: String,
    name: String,
    target: Option<String>,
    message: Option<String>,
) -> Result<(), String> {
    blocking(move || cli::create_tag(Path::new(&path), &name, target.as_deref(), message)).await
}

#[tauri::command]
async fn delete_tag(
    app: AppHandle,
    path: String,
    name: String,
    remote: Option<String>,
) -> Result<String, String> {
    blocking(move || {
        let repo = open(&path)?;
        let auth = remote
            .as_deref()
            .and_then(|remote| remote_auth_arg(&app, &repo, Some(remote), true));
        cli::delete_tag(Path::new(&path), &name, remote.as_deref(), auth.as_deref())
    })
    .await
}

fn remote_auth_arg(
    app: &AppHandle,
    repo: &git2::Repository,
    remote: Option<&str>,
    pushing: bool,
) -> Option<String> {
    let gitlab_cfg = gitlab::load_file_pub(app);
    let gitlab_auth = match remote {
        Some(remote) => gitlab::auth_arg_for_remote(repo, remote, pushing, &gitlab_cfg),
        None => gitlab::auth_arg_for_repo(repo, &gitlab_cfg),
    };
    gitlab_auth.or_else(|| match remote {
        Some(remote) => github::auth_arg_for_remote(repo, remote, pushing),
        None => github::auth_arg_for_repo(repo),
    })
}

#[tauri::command]
async fn git_fetch(
    app: AppHandle,
    path: String,
    remote: Option<String>,
    prune: bool,
) -> Result<String, String> {
    blocking(move || {
        let repo = open(&path)?;
        let auth = remote_auth_arg(&app, &repo, remote.as_deref(), false);
        match remote {
            Some(remote) => cli::fetch_remote(Path::new(&path), &remote, auth.as_deref(), prune),
            None => cli::fetch_all(Path::new(&path), auth.as_deref(), prune),
        }
    })
    .await
}

#[tauri::command]
async fn git_pull(
    app: AppHandle,
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    strategy: String,
) -> Result<String, String> {
    blocking(move || {
        let repo = open(&path)?;
        let auth = remote_auth_arg(&app, &repo, remote.as_deref(), false);
        cli::pull(
            Path::new(&path),
            remote.as_deref(),
            branch.as_deref(),
            &strategy,
            auth.as_deref(),
        )
    })
    .await
}

#[tauri::command]
async fn git_push(
    app: AppHandle,
    path: String,
    remote: Option<String>,
    force_with_lease: bool,
) -> Result<String, String> {
    blocking(move || {
        let repo = open(&path)?;
        let auth = remote_auth_arg(&app, &repo, remote.as_deref(), true);
        match remote {
            Some(remote) => {
                cli::push_remote(Path::new(&path), &remote, auth.as_deref(), force_with_lease)
            }
            None => cli::push(Path::new(&path), auth.as_deref()),
        }
    })
    .await
}

#[tauri::command]
async fn git_push_tags(app: AppHandle, path: String, remote: String) -> Result<String, String> {
    blocking(move || {
        let repo = open(&path)?;
        let auth = remote_auth_arg(&app, &repo, Some(&remote), true);
        cli::push_tags(Path::new(&path), &remote, auth.as_deref())
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

#[tauri::command]
async fn get_gitlab_projects(
    app: AppHandle,
    page: u32,
) -> Result<Vec<gitlab::GitlabProject>, String> {
    blocking(move || gitlab::list_projects(&app, page)).await
}

#[tauri::command]
async fn get_github_settings() -> Result<github::GitHubSettingsView, String> {
    blocking(|| Ok(github::settings_view())).await
}

#[tauri::command]
async fn save_github_settings(token: Option<String>) -> Result<(), String> {
    blocking(move || github::save_settings(token)).await
}

#[tauri::command]
async fn clear_github_settings() -> Result<(), String> {
    blocking(|| {
        github::clear_settings();
        Ok(())
    })
    .await
}

#[tauri::command]
async fn test_github_connection(token: Option<String>) -> Result<String, String> {
    blocking(move || {
        let token = github::token_for_test(token)
            .ok_or_else(|| "no token provided and none stored".to_string())?;
        github::test_connection(&token)
    })
    .await
}

#[tauri::command]
async fn get_github_repositories(page: u32) -> Result<Vec<github::GitHubRepository>, String> {
    blocking(move || github::list_repositories(page)).await
}

// ---------------------------------------------------------------------------
// Clone / stash / merge / rebase
// ---------------------------------------------------------------------------

#[tauri::command]
async fn clone_repo(app: AppHandle, url: String, parent: String) -> Result<String, String> {
    blocking(move || {
        let cfg = gitlab::load_file_pub(&app);
        let auth = gitlab::auth_arg_for_url(&url, &cfg)
            .or_else(|| github::auth_arg_for_url(&url));
        cli::clone_repo(&url, Path::new(&parent), auth.as_deref())
    })
    .await
}

#[tauri::command]
async fn init_repo(path: String, initial_commit: bool) -> Result<String, String> {
    blocking(move || cli::init_repo(Path::new(&path), initial_commit)).await
}

#[tauri::command]
async fn get_stashes(path: String) -> Result<Vec<cli::StashInfo>, String> {
    blocking(move || {
        let repo = open(&path)?;
        if repo.is_bare() {
            return Ok(vec![]);
        }
        cli::stash_list(Path::new(&path))
    })
    .await
}

#[tauri::command]
async fn stash_push(
    path: String,
    message: Option<String>,
    staged_only: bool,
    include_untracked: bool,
    files: Vec<String>,
) -> Result<String, String> {
    blocking(move || {
        cli::stash_push(
            Path::new(&path),
            message.as_deref(),
            staged_only,
            include_untracked,
            &files,
        )
    })
    .await
}

#[tauri::command]
async fn stash_apply(path: String, index: u32) -> Result<String, String> {
    blocking(move || cli::stash_apply(Path::new(&path), index)).await
}

#[tauri::command]
async fn stash_pop(path: String, index: u32) -> Result<String, String> {
    blocking(move || cli::stash_pop(Path::new(&path), index)).await
}

#[tauri::command]
async fn stash_drop(path: String, index: u32) -> Result<String, String> {
    blocking(move || cli::stash_drop(Path::new(&path), index)).await
}

#[tauri::command]
async fn merge_branch(path: String, name: String) -> Result<String, String> {
    blocking(move || cli::merge_branch(Path::new(&path), &name)).await
}

#[tauri::command]
async fn cherry_pick_commit(path: String, commit: String) -> Result<String, String> {
    blocking(move || cli::cherry_pick_commit(Path::new(&path), &commit)).await
}

#[tauri::command]
async fn revert_commit(path: String, commit: String) -> Result<String, String> {
    blocking(move || cli::revert_commit(Path::new(&path), &commit)).await
}

#[tauri::command]
async fn reset_to_commit(path: String, commit: String, mode: String) -> Result<String, String> {
    blocking(move || cli::reset_to_commit(Path::new(&path), &commit, &mode)).await
}

#[tauri::command]
async fn resolve_conflict(path: String, file: String, use_ours: bool) -> Result<(), String> {
    blocking(move || cli::resolve_conflict(Path::new(&path), &file, use_ours)).await
}

#[tauri::command]
async fn get_conflict_file_content(path: String, file: String) -> Result<String, String> {
    blocking(move || cli::conflict_file_content(Path::new(&path), &file)).await
}

#[tauri::command]
async fn resolve_conflict_manually(
    path: String,
    file: String,
    content: String,
) -> Result<(), String> {
    blocking(move || cli::resolve_conflict_manually(Path::new(&path), &file, &content)).await
}

/// Abort whatever operation (merge/revert/cherry-pick/rebase) is in progress.
#[tauri::command]
async fn abort_operation(path: String) -> Result<String, String> {
    blocking(move || {
        let repo = open(&path)?;
        let op = match repo.state() {
            git2::RepositoryState::Merge => "merge",
            git2::RepositoryState::Revert => "revert",
            git2::RepositoryState::CherryPick => "cherry-pick",
            git2::RepositoryState::RebaseMerge | git2::RepositoryState::RebaseInteractive => {
                "rebase"
            }
            _ => return Err("no operation in progress".to_string()),
        };
        cli::abort_operation(Path::new(&path), op)
    })
    .await
}

#[tauri::command]
async fn rebase_commits(path: String, base: String) -> Result<Vec<cli::RebaseCommit>, String> {
    blocking(move || cli::rebase_commits(Path::new(&path), &base)).await
}

#[tauri::command]
async fn rebase_execute(
    path: String,
    base: String,
    items: Vec<cli::RebaseItem>,
) -> Result<String, String> {
    blocking(move || cli::rebase_execute(Path::new(&path), &base, &items)).await
}

#[tauri::command]
async fn rebase_continue(path: String) -> Result<String, String> {
    blocking(move || cli::rebase_continue(Path::new(&path))).await
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Work around a WebKitGTK teardown crash on Linux: the dmabuf renderer
    // can corrupt the heap in Mesa/GBM when the web process exits, producing
    // a SIGABRT crash report on every window close. Must be set before the
    // web process is spawned so it is inherited from the environment.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_repo,
            get_status,
            get_log,
            get_older_log,
            compare_branches,
            get_branches,
            get_remotes,
            get_worktrees,
            get_reflog,
            get_file_history,
            get_file_blame,
            search_commits,
            get_bisect_state,
            get_submodules,
            update_submodule,
            bisect_start,
            bisect_mark,
            bisect_reset,
            get_review_link,
            get_tags,
            get_remote_tags,
            get_file_diff,
            get_file_hunks,
            get_commit_file_diff,
            get_commit_details,
            stage_files,
            unstage_files,
            ignore_file,
            apply_file_hunk,
            discard_worktree_file,
            discard_worktree_hunk,
            stage_all,
            unstage_all,
            commit,
            checkout_branch,
            create_branch,
            delete_branch,
            recover_branch_at_commit,
            add_worktree,
            remove_worktree,
            add_remote,
            set_remote_url,
            remove_remote,
            set_upstream,
            delete_remote_branch,
            create_tag,
            delete_tag,
            git_fetch,
            git_pull,
            git_push,
            git_push_tags,
            get_gitlab_settings,
            save_gitlab_settings,
            clear_gitlab_settings,
            test_gitlab_connection,
            get_gitlab_projects,
            get_github_settings,
            save_github_settings,
            clear_github_settings,
            test_github_connection,
            get_github_repositories,
            clone_repo,
            init_repo,
            get_stashes,
            stash_push,
            stash_apply,
            stash_pop,
            stash_drop,
            merge_branch,
            cherry_pick_commit,
            revert_commit,
            reset_to_commit,
            resolve_conflict,
            get_conflict_file_content,
            resolve_conflict_manually,
            abort_operation,
            rebase_commits,
            rebase_execute,
            rebase_continue,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
