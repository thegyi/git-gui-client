//! Mutating git operations shell out to the `git` CLI so hooks,
//! config, aliases and edge cases behave exactly like the terminal.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

fn run<A>(repo: &Path, args: &[A]) -> Result<String, String>
where
    A: AsRef<OsStr>,
{
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|e| format!("failed to execute git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    pub commit_id: String,
    pub short_id: String,
    pub selector: String,
    pub action: String,
    pub time: i64,
}

fn run_str(repo: &Path, args: &[&str]) -> Result<String, String> {
    run(repo, args)
}

pub fn reflog(repo: &Path, limit: usize) -> Result<Vec<ReflogEntry>, String> {
    let output = run_str(
        repo,
        &[
            "reflog",
            "show",
            "--all",
            "--date=unix",
            &format!("--format=%H%x00%gD%x00%gs%x00%ct"),
            "-n",
            &limit.to_string(),
        ],
    )?;
    output
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let fields: Vec<&str> = line.split('\0').collect();
            if fields.len() != 4 {
                return Err("unexpected git reflog output".to_string());
            }
            let commit_id = fields[0].to_string();
            Ok(ReflogEntry {
                short_id: commit_id.chars().take(7).collect(),
                commit_id,
                selector: fields[1].to_string(),
                action: fields[2].to_string(),
                time: fields[3]
                    .parse()
                    .map_err(|error| format!("invalid reflog timestamp: {error}"))?,
            })
        })
        .collect()
}

pub fn recover_branch_at_commit(repo: &Path, branch: &str, commit: &str) -> Result<(), String> {
    if branch.trim().is_empty() {
        return Err("recovery branch name is required".to_string());
    }
    run_str(repo, &["check-ref-format", "--branch", branch.trim()])?;
    let revision = format!("{commit}^{{commit}}");
    let commit_id = run_str(
        repo,
        &["rev-parse", "--verify", "--end-of-options", &revision],
    )?;
    run_str(repo, &["branch", branch.trim(), &commit_id]).map(|_| ())
}

pub fn worktrees(repo: &Path) -> Result<Vec<super::WorktreeInfo>, String> {
    let output = run_str(repo, &["worktree", "list", "--porcelain"])?;
    let current = fs::canonicalize(repo).unwrap_or_else(|_| repo.to_path_buf());
    let mut result = Vec::new();
    let mut path: Option<String> = None;
    let mut head = None;
    let mut branch = None;
    let mut is_bare = false;
    let mut is_detached = false;

    let push_entry = |result: &mut Vec<super::WorktreeInfo>,
                      path: &mut Option<String>,
                      head: &mut Option<String>,
                      branch: &mut Option<String>,
                      is_bare: &mut bool,
                      is_detached: &mut bool| {
        let Some(worktree_path) = path.take() else {
            return;
        };
        let worktree_path_buf = PathBuf::from(&worktree_path);
        let canonical = fs::canonicalize(&worktree_path_buf).unwrap_or(worktree_path_buf);
        result.push(super::WorktreeInfo {
            is_current: canonical == current,
            path: worktree_path,
            head: head.take(),
            branch: branch.take(),
            is_bare: std::mem::take(is_bare),
            is_detached: std::mem::take(is_detached),
        });
    };

    for line in output.lines() {
        if line.is_empty() {
            push_entry(
                &mut result,
                &mut path,
                &mut head,
                &mut branch,
                &mut is_bare,
                &mut is_detached,
            );
        } else if let Some(value) = line.strip_prefix("worktree ") {
            path = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("HEAD ") {
            head = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("branch ") {
            branch = Some(value.strip_prefix("refs/heads/").unwrap_or(value).to_string());
        } else if line == "bare" {
            is_bare = true;
        } else if line == "detached" {
            is_detached = true;
        }
    }
    push_entry(
        &mut result,
        &mut path,
        &mut head,
        &mut branch,
        &mut is_bare,
        &mut is_detached,
    );
    Ok(result)
}

pub fn add_worktree(
    repo: &Path,
    path: &str,
    start_point: &str,
    new_branch: Option<&str>,
) -> Result<(), String> {
    if path.trim().is_empty() || start_point.trim().is_empty() {
        return Err("worktree path and start point are required".to_string());
    }
    let mut args = vec!["worktree".to_string(), "add".to_string()];
    if let Some(branch) = new_branch.map(str::trim).filter(|name| !name.is_empty()) {
        args.push("-b".to_string());
        args.push(branch.to_string());
    }
    args.push(path.trim().to_string());
    args.push(start_point.trim().to_string());
    run(repo, &args).map(|_| ())
}

pub fn remove_worktree(repo: &Path, path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("worktree path is required".to_string());
    }
    let current = fs::canonicalize(repo).unwrap_or_else(|_| repo.to_path_buf());
    let target = Path::new(path.trim());
    let target_canonical = fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf());
    if target_canonical == current {
        return Err("cannot remove the currently opened worktree".to_string());
    }
    run_str(repo, &["worktree", "remove", path.trim()]).map(|_| ())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileHunk {
    pub header: String,
    pub additions: usize,
    pub deletions: usize,
    pub patch: String,
}

pub fn file_hunks(repo: &Path, path: &str, staged: bool) -> Result<Vec<FileHunk>, String> {
    let pathspec = format!(":(literal){path}");
    let tracked = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["ls-files", "--error-unmatch", "--", &pathspec])
        .output()
        .map_err(|e| format!("failed to execute git: {e}"))?
        .status
        .success();

    let mut args = vec!["diff", "--no-ext-diff", "--no-color", "--unified=3"];
    if staged {
        args.push("--cached");
    } else if !tracked {
        args.extend(["--no-index", "--", "/dev/null", path]);
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(&args)
            .output()
            .map_err(|e| format!("failed to execute git: {e}"))?;
        if !output.status.success() && output.status.code() != Some(1) {
            return Err(command_error(&output.stderr, &output.stdout));
        }
        return parse_file_hunks(&String::from_utf8_lossy(&output.stdout));
    }
    args.extend(["--", &pathspec]);
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(&args)
        .output()
        .map_err(|e| format!("failed to execute git: {e}"))?;
    if !output.status.success() {
        return Err(command_error(&output.stderr, &output.stdout));
    }
    parse_file_hunks(&String::from_utf8_lossy(&output.stdout))
}

fn parse_file_hunks(patch: &str) -> Result<Vec<FileHunk>, String> {
    let lines: Vec<&str> = patch.lines().collect();
    let starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| line.starts_with("@@ ").then_some(i))
        .collect();
    let Some(&first_start) = starts.first() else {
        return Ok(Vec::new());
    };
    let header = lines[..first_start].join("\n");
    Ok(starts
        .iter()
        .enumerate()
        .map(|(index, &start)| {
            let end = starts.get(index + 1).copied().unwrap_or(lines.len());
            let hunk_lines = &lines[start..end];
            let mut hunk_patch = format!("{header}\n{}\n", hunk_lines.join("\n"));
            if header.is_empty() {
                hunk_patch = format!("{}\n", hunk_lines.join("\n"));
            }
            FileHunk {
                header: hunk_lines[0].to_string(),
                additions: hunk_lines
                    .iter()
                    .filter(|line| line.starts_with('+'))
                    .count(),
                deletions: hunk_lines
                    .iter()
                    .filter(|line| line.starts_with('-'))
                    .count(),
                patch: hunk_patch,
            }
        })
        .collect())
}

fn command_error(stderr: &[u8], stdout: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    if stderr.is_empty() {
        String::from_utf8_lossy(stdout).trim().to_string()
    } else {
        stderr
    }
}

fn conflict_file_path(repo: &Path, path: &str) -> Result<(PathBuf, PathBuf, String), String> {
    let relative_path = Path::new(path);
    if relative_path.as_os_str().is_empty()
        || relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("invalid conflict file path".to_string());
    }

    let root = run_str(repo, &["rev-parse", "--show-toplevel"])?;
    let root = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("failed to resolve repository path: {e}"))?;
    let file_path = root.join(relative_path);
    let metadata = fs::symlink_metadata(&file_path)
        .map_err(|e| format!("failed to inspect conflict file: {e}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("conflict file must be a regular file".to_string());
    }
    let resolved = file_path
        .canonicalize()
        .map_err(|e| format!("failed to resolve conflict file: {e}"))?;
    if !resolved.starts_with(&root) {
        return Err("conflict file is outside the repository".to_string());
    }

    let pathspec = format!(":(literal){path}");
    let unmerged = Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["ls-files", "-u", "--", &pathspec])
        .output()
        .map_err(|e| format!("failed to execute git: {e}"))?;
    if !unmerged.status.success() {
        return Err(command_error(&unmerged.stderr, &unmerged.stdout));
    }
    if unmerged.stdout.is_empty() {
        return Err("file is no longer in conflict".to_string());
    }

    Ok((root, resolved, pathspec))
}

pub fn conflict_file_content(repo: &Path, path: &str) -> Result<String, String> {
    let (_, file_path, _) = conflict_file_path(repo, path)?;
    let content = fs::read(file_path).map_err(|e| format!("failed to read conflict file: {e}"))?;
    String::from_utf8(content)
        .map_err(|_| "binary conflict files cannot be edited here".to_string())
}

pub fn resolve_conflict_manually(repo: &Path, path: &str, content: &str) -> Result<(), String> {
    let (root, file_path, pathspec) = conflict_file_path(repo, path)?;
    fs::write(file_path, content).map_err(|e| format!("failed to write resolved file: {e}"))?;
    run_str(&root, &["add", "--", &pathspec]).map(|_| ())
}

pub fn apply_file_hunk(repo: &Path, path: &str, staged: bool, patch: &str) -> Result<(), String> {
    let hunks = file_hunks(repo, path, staged)?;
    if !hunks.iter().any(|hunk| hunk.patch == patch) {
        return Err("The diff hunk changed; refresh the diff and try again.".to_string());
    }

    let mut command = Command::new("git");
    command.arg("-C").arg(repo).arg("apply").arg("--cached");
    if staged {
        command.arg("--reverse");
    }
    let mut child = command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to execute git: {e}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "failed to open git stdin".to_string())?
        .write_all(patch.as_bytes())
        .map_err(|e| format!("failed to send patch to git: {e}"))?;
    let output = child
        .wait_with_output()
        .map_err(|e| format!("failed to wait for git: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(&output.stderr, &output.stdout))
    }
}

pub fn stage_all(repo: &Path) -> Result<(), String> {
    run_str(repo, &["add", "-A"]).map(|_| ())
}

pub fn unstage_all(repo: &Path) -> Result<(), String> {
    // `git reset` (mixed) unstages everything but keeps the worktree.
    run_str(repo, &["reset", "-q"]).map(|_| ())
}

pub fn stage_files(repo: &Path, files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["add", "--"];
    args.extend(files.iter().map(|s| s.as_str()));
    run_str(repo, &args).map(|_| ())
}

pub fn unstage_files(repo: &Path, files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["restore", "--staged", "--"];
    args.extend(files.iter().map(|s| s.as_str()));
    run_str(repo, &args).map(|_| ())
}

/// Commit (or amend). Returns the new HEAD commit id.
/// Amend with an empty message keeps the existing one (`--no-edit`).
pub fn commit(repo: &Path, message: &str, amend: bool) -> Result<String, String> {
    let mut args: Vec<String> = vec!["commit".to_string()];
    if amend {
        args.push("--amend".to_string());
    }
    if amend && message.trim().is_empty() {
        args.push("--no-edit".to_string());
    } else {
        args.push("-m".to_string());
        args.push(message.to_string());
    }
    run(repo, &args)?;
    run_str(repo, &["rev-parse", "HEAD"])
}

/// Check whether a local branch exists.
fn local_branch_exists(repo: &Path, name: &str) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["rev-parse", "--verify", "--quiet", &format!("refs/heads/{name}")])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check whether a remote-tracking branch exists.
fn remote_branch_exists(repo: &Path, name: &str) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["rev-parse", "--verify", "--quiet", &format!("refs/remotes/{name}")])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Switch to a branch. Remote-only branches (e.g. `origin/foo`) are checked
/// out as a new local tracking branch.
pub fn checkout_branch(repo: &Path, name: &str) -> Result<(), String> {
    if local_branch_exists(repo, name) {
        return run_str(repo, &["checkout", name]).map(|_| ());
    }
    if remote_branch_exists(repo, name) {
        // origin/foo -> local branch "foo" tracking origin/foo
        let short = name.split_once('/').map(|(_, s)| s).unwrap_or(name);
        if local_branch_exists(repo, short) {
            return run_str(repo, &["checkout", short]).map(|_| ());
        }
        return run_str(repo, &["checkout", "-b", short, "--track", name]).map(|_| ());
    }
    // Fall back: tag or commit-ish (detached HEAD).
    run_str(repo, &["checkout", name]).map(|_| ())
}

pub fn create_branch(repo: &Path, name: &str, checkout: bool) -> Result<(), String> {
    if checkout {
        run_str(repo, &["checkout", "-b", name]).map(|_| ())
    } else {
        run_str(repo, &["branch", name]).map(|_| ())
    }
}

pub fn delete_branch(repo: &Path, name: &str) -> Result<(), String> {
    run_str(repo, &["branch", "-D", name]).map(|_| ())
}

pub fn add_remote(repo: &Path, name: &str, url: &str) -> Result<(), String> {
    if name.trim().is_empty() || url.trim().is_empty() {
        return Err("remote name and URL are required".to_string());
    }
    run_str(repo, &["remote", "add", name.trim(), url.trim()]).map(|_| ())
}

pub fn set_remote_url(repo: &Path, name: &str, url: &str) -> Result<(), String> {
    if name.trim().is_empty() || url.trim().is_empty() {
        return Err("remote name and URL are required".to_string());
    }
    run_str(repo, &["remote", "set-url", name.trim(), url.trim()]).map(|_| ())
}

pub fn remove_remote(repo: &Path, name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("remote name is required".to_string());
    }
    run_str(repo, &["remote", "remove", name.trim()]).map(|_| ())
}

pub fn set_upstream(repo: &Path, branch: &str, upstream: Option<&str>) -> Result<(), String> {
    if branch.trim().is_empty() {
        return Err("local branch name is required".to_string());
    }
    let branch_ref = format!("refs/heads/{}", branch.trim());
    run_str(repo, &["show-ref", "--verify", "--quiet", &branch_ref])?;
    match upstream.map(str::trim).filter(|name| !name.is_empty()) {
        Some(upstream) => run_str(
            repo,
            &[
                "branch",
                &format!("--set-upstream-to={upstream}"),
                branch.trim(),
            ],
        )
        .map(|_| ()),
        None => {
            let current_upstream =
                run_str(repo, &["for-each-ref", "--format=%(upstream)", &branch_ref])?;
            if current_upstream.is_empty() {
                return Ok(());
            }
            run_str(repo, &["branch", "--unset-upstream", branch.trim()]).map(|_| ())
        }
    }
}

pub fn create_tag(
    repo: &Path,
    name: &str,
    target: Option<&str>,
    message: Option<String>,
) -> Result<(), String> {
    let mut args = vec!["tag".to_string()];
    if let Some(msg) = message.filter(|msg| !msg.trim().is_empty()) {
        args.extend([
            "-a".to_string(),
            name.to_string(),
            "-m".to_string(),
            msg.trim().to_string(),
        ]);
    } else {
        args.extend([name.to_string()]);
    }
    if let Some(target) = target {
        args.push(target.to_string());
    }
    run(repo, &args).map(|_| ())
}

pub fn delete_tag(repo: &Path, name: &str) -> Result<(), String> {
    run_str(repo, &["tag", "-d", name]).map(|_| ())
}

// ---------------------------------------------------------------------------
// Remote operations
// ---------------------------------------------------------------------------

/// Run a (possibly network) git command and return combined output.
/// Terminal prompts and editors are disabled so the GUI never hangs
/// waiting for credentials or input that has nowhere to go.
fn run_net<A>(repo: &Path, args: &[A]) -> Result<String, String>
where
    A: AsRef<OsStr>,
{
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .output()
        .map_err(|e| format!("failed to execute git: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{stdout}{stderr}").trim().to_string();
    if out.status.success() {
        Ok(combined)
    } else {
        Err(combined)
    }
}

/// Prepend `-c <arg>` git config overrides (e.g. an auth extraheader) before
/// the subcommand.
fn with_config_args(args: &mut Vec<String>, config: Option<&str>) {
    if let Some(c) = config {
        args.push("-c".to_string());
        args.push(c.to_string());
    }
}

pub fn fetch_all(repo: &Path, auth: Option<&str>, prune: bool) -> Result<String, String> {
    let mut args = Vec::new();
    with_config_args(&mut args, auth);
    args.extend(["fetch", "--all"].map(String::from));
    args.push(if prune { "--prune" } else { "--no-prune" }.to_string());
    run_net(repo, &args)
}

pub fn fetch_remote(
    repo: &Path,
    remote: &str,
    auth: Option<&str>,
    prune: bool,
) -> Result<String, String> {
    let mut args = Vec::new();
    with_config_args(&mut args, auth);
    args.push("fetch".to_string());
    args.push(if prune { "--prune" } else { "--no-prune" }.to_string());
    args.push(remote.to_string());
    run_net(repo, &args)
}

pub fn pull(
    repo: &Path,
    remote: Option<&str>,
    branch: Option<&str>,
    strategy: &str,
    auth: Option<&str>,
) -> Result<String, String> {
    let strategy_arg = match strategy {
        "merge" => Some("--no-rebase"),
        "rebase" => Some("--rebase"),
        "ff-only" => Some("--ff-only"),
        _ => return Err(format!("unsupported pull strategy: {strategy}")),
    };
    if remote.is_some() != branch.is_some() {
        return Err("select both a remote and branch, or use the configured upstream".to_string());
    }
    if let (Some(remote), Some(branch)) = (remote, branch) {
        if remote.trim().is_empty() || branch.trim().is_empty() {
            return Err("remote and branch must not be empty".to_string());
        }
        run_str(repo, &["remote", "get-url", remote])?;
        let branch_ref = format!("refs/heads/{}", branch.trim());
        run_str(repo, &["check-ref-format", &branch_ref])?;
    }
    let mut args = Vec::new();
    with_config_args(&mut args, auth);
    args.push("pull".to_string());
    if let Some(strategy) = strategy_arg {
        args.push(strategy.to_string());
    }
    if let (Some(remote), Some(branch)) = (remote, branch) {
        args.push(remote.to_string());
        args.push(branch.to_string());
    }
    run_net(repo, &args)
}

pub fn push(repo: &Path, auth: Option<&str>) -> Result<String, String> {
    let mut args = Vec::new();
    with_config_args(&mut args, auth);
    args.push("push".to_string());
    run_net(repo, &args)
}

pub fn push_remote(
    repo: &Path,
    remote: &str,
    auth: Option<&str>,
    force_with_lease: bool,
) -> Result<String, String> {
    let branch = run_str(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .map_err(|_| "cannot push while HEAD is detached".to_string())?;
    let refspec = format!("HEAD:refs/heads/{branch}");
    let mut args = Vec::new();
    with_config_args(&mut args, auth);
    args.push("push".to_string());
    if force_with_lease {
        args.push("--force-with-lease".to_string());
    }
    args.extend([remote.to_string(), refspec]);
    run_net(repo, &args)
}

pub fn push_tags(repo: &Path, remote: &str, auth: Option<&str>) -> Result<String, String> {
    if remote.trim().is_empty() {
        return Err("remote name is required".to_string());
    }
    let mut args = Vec::new();
    with_config_args(&mut args, auth);
    args.extend(["push".to_string(), "--tags".to_string(), remote.to_string()]);
    run_net(repo, &args)
}

pub fn delete_remote_branch(
    repo: &Path,
    remote_branch: &str,
    auth: Option<&str>,
) -> Result<String, String> {
    let remotes = run_str(repo, &["remote"])?;
    let [remote, branch] = split_remote_branch_name(&remotes, remote_branch)?;
    let mut args = Vec::new();
    with_config_args(&mut args, auth);
    args.extend(["push".to_string(), "--delete".to_string(), remote, branch]);
    let output = run_net(repo, &args)?;
    run_str(repo, &["branch", "-dr", remote_branch]).map_err(|error| {
        format!("remote branch was deleted, but its local tracking reference could not be removed: {error}")
    })?;
    Ok(output)
}

fn split_remote_branch_name(remotes: &str, remote_branch: &str) -> Result<[String; 2], String> {
    remotes
        .lines()
        .filter_map(|remote| {
            remote_branch
                .strip_prefix(&format!("{remote}/"))
                .filter(|branch| !branch.is_empty())
                .map(|branch| (remote, branch))
        })
        .max_by_key(|(remote, _)| remote.len())
        .map(|(remote, branch)| [remote.to_string(), branch.to_string()])
        .ok_or_else(|| format!("could not identify remote for branch: {remote_branch}"))
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

/// Clone `url` into `parent/<repo-name>`; returns the new repo path.
pub fn clone_repo(url: &str, parent: &Path, auth: Option<&str>) -> Result<String, String> {
    let name = url
        .trim()
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim_end_matches(".git")
        .to_string();
    if name.is_empty() {
        return Err("could not determine repository name from URL".to_string());
    }
    let dest = parent.join(&name);
    if dest.exists() {
        return Err(format!("{} already exists", dest.display()));
    }
    let mut args = vec!["-C".to_string(), parent.to_string_lossy().into_owned()];
    with_config_args(&mut args, auth);
    args.extend(["clone".to_string(), url.trim().to_string()]);
    let out = Command::new("git")
        .args(&args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("failed to execute git: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    Ok(dest.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Stash
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashInfo {
    pub index: u32,
    pub message: String,
    pub time: i64,
}

pub fn stash_list(repo: &Path) -> Result<Vec<StashInfo>, String> {
    let out = run_str(repo, &["stash", "list", "--format=%gd%x1f%gs%x1f%ct"])?;
    Ok(out
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            let gd = parts.next()?;
            let message = parts.next().unwrap_or("").to_string();
            let time: i64 = parts.next().and_then(|t| t.parse().ok()).unwrap_or(0);
            let index = gd
                .trim_start_matches("stash@{")
                .trim_end_matches('}')
                .parse()
                .ok()?;
            Some(StashInfo {
                index,
                message,
                time,
            })
        })
        .collect())
}

/// Stash tracked + untracked changes. `message` becomes the stash description.
pub fn stash_push(repo: &Path, message: Option<&str>) -> Result<String, String> {
    let mut args: Vec<String> = vec!["stash".into(), "push".into(), "-u".into()];
    if let Some(m) = message.map(str::trim).filter(|m| !m.is_empty()) {
        args.push("-m".into());
        args.push(m.to_string());
    }
    run(repo, &args)
}

pub fn stash_apply(repo: &Path, index: u32) -> Result<String, String> {
    run_str(repo, &["stash", "apply", &format!("stash@{{{index}}}")])
}

pub fn stash_pop(repo: &Path, index: u32) -> Result<String, String> {
    run_str(repo, &["stash", "pop", &format!("stash@{{{index}}}")])
}

pub fn stash_drop(repo: &Path, index: u32) -> Result<String, String> {
    run_str(repo, &["stash", "drop", &format!("stash@{{{index}}}")])
}

// ---------------------------------------------------------------------------
// Merge / conflicts
// ---------------------------------------------------------------------------

/// Merge a local branch into HEAD. Exits non-zero with conflict output when
/// the merge cannot be completed automatically.
pub fn merge_branch(repo: &Path, name: &str) -> Result<String, String> {
    run_str(repo, &["merge", "--no-edit", name])
}

pub fn cherry_pick_commit(repo: &Path, commit: &str) -> Result<String, String> {
    run_str(repo, &["cherry-pick", "--no-edit", commit])
}

pub fn revert_commit(repo: &Path, commit: &str) -> Result<String, String> {
    run_str(repo, &["revert", "--no-edit", commit])
}

pub fn reset_to_commit(repo: &Path, commit: &str, mode: &str) -> Result<String, String> {
    let mode_arg = match mode {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => return Err(format!("unsupported reset mode: {mode}")),
    };
    let revision = format!("{commit}^{{commit}}");
    let commit_id = run_str(
        repo,
        &["rev-parse", "--verify", "--end-of-options", &revision],
    )?;
    run_str(repo, &["reset", mode_arg, &commit_id])
}

/// Abort the in-progress merge/revert/cherry-pick/rebase (`op` is the git
/// subcommand, e.g. "merge").
pub fn abort_operation(repo: &Path, op: &str) -> Result<String, String> {
    run_str(repo, &[op, "--abort"])
}

/// Resolve one conflicted path by taking our (`--ours`) or their
/// (`--theirs`) side, then stage it.
pub fn resolve_conflict(repo: &Path, path: &str, use_ours: bool) -> Result<(), String> {
    let side = if use_ours { "--ours" } else { "--theirs" };
    run_str(repo, &["checkout", side, "--", path])?;
    run_str(repo, &["add", "--", path]).map(|_| ())
}

// ---------------------------------------------------------------------------
// Interactive rebase
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseCommit {
    pub id: String,
    pub short_id: String,
    pub subject: String,
}

/// Commits that `git rebase -i <base>` would offer, oldest first.
pub fn rebase_commits(repo: &Path, base: &str) -> Result<Vec<RebaseCommit>, String> {
    let range = format!("{base}..HEAD");
    let out = run_str(
        repo,
        &["log", "--no-merges", "--reverse", "--format=%H%x1f%s", &range],
    )?;
    Ok(out
        .lines()
        .filter_map(|line| {
            let (id, subject) = line.split_once('\x1f')?;
            Some(RebaseCommit {
                short_id: id[..id.len().min(7)].to_string(),
                id: id.to_string(),
                subject: subject.to_string(),
            })
        })
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseItem {
    pub id: String,
    pub action: String, // pick | squash | fixup | drop
}

/// Run `git rebase -i <base>` with a generated todo list. `items` must cover
/// every commit in the range exactly once; order defines the new history.
pub fn rebase_execute(repo: &Path, base: &str, items: &[RebaseItem]) -> Result<String, String> {
    let commits = rebase_commits(repo, base)?;
    if commits.is_empty() {
        return Err("nothing to rebase".to_string());
    }
    let subjects: HashMap<&str, &str> = commits
        .iter()
        .map(|c| (c.id.as_str(), c.subject.as_str()))
        .collect();

    let mut seen = std::collections::HashSet::new();
    let mut todo = String::new();
    for (pos, item) in items.iter().enumerate() {
        let Some(subject) = subjects.get(item.id.as_str()) else {
            return Err(format!("commit {} is not in the rebase range", item.id));
        };
        if !seen.insert(item.id.as_str()) {
            return Err(format!("commit {} listed twice", item.id));
        }
        let action = match item.action.as_str() {
            "squash" | "fixup" | "drop" => item.action.as_str(),
            _ => "pick",
        };
        if pos == 0 && action != "pick" {
            return Err(format!("the first commit cannot be '{action}'"));
        }
        todo.push_str(&format!("{action} {} {}\n", item.id, subject));
    }
    if seen.len() != commits.len() {
        return Err("every commit in the range must be listed exactly once".to_string());
    }

    let todo_path =
        std::env::temp_dir().join(format!("git-gui-rebase-{}-todo", std::process::id()));
    std::fs::write(&todo_path, &todo).map_err(|e| format!("cannot write todo file: {e}"))?;

    // GIT_SEQUENCE_EDITOR runs as `<editor> "<file>"` through the shell, so
    // `cp '<todo>'` overwrites git's generated todo with ours.
    let editor = format!("cp '{}' ", todo_path.display());
    let result = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["rebase", "-i", base])
        .env("GIT_SEQUENCE_EDITOR", editor)
        .env("GIT_EDITOR", "true")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output();
    let _ = std::fs::remove_file(&todo_path);

    let out = result.map_err(|e| format!("failed to execute git: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{stdout}{stderr}").trim().to_string();
    if out.status.success() {
        Ok(combined)
    } else {
        Err(combined)
    }
}

/// Continue a rebase stopped on conflicts/squash, accepting default messages.
pub fn rebase_continue(repo: &Path) -> Result<String, String> {
    run_net(repo, &["-c", "core.editor=true", "rebase", "--continue"])
}

#[cfg(test)]
mod tests {
    use super::{
        add_remote, apply_file_hunk, cherry_pick_commit, conflict_file_content, create_tag,
        delete_tag, fetch_remote, file_hunks, push_remote, push_tags, remove_remote,
        reset_to_commit, resolve_conflict_manually, revert_commit, set_remote_url, set_upstream,
        split_remote_branch_name, add_worktree, recover_branch_at_commit, reflog,
        remove_worktree, worktrees, pull,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TestRepo(PathBuf);

    impl TestRepo {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "git-gui-client-test-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir(&path).unwrap();
            git(&path, &["init"]);
            git(&path, &["config", "user.name", "Test"]);
            git(&path, &["config", "user.email", "test@example.com"]);
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    fn git(repo: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn repo_with_two_commits() -> (TestRepo, String) {
        let repo = TestRepo::new();
        fs::write(repo.path().join("file.txt"), "base\n").unwrap();
        git(repo.path(), &["add", "file.txt"]);
        git(repo.path(), &["commit", "-m", "base"]);
        let target = git(repo.path(), &["rev-parse", "HEAD"]);
        fs::write(repo.path().join("file.txt"), "committed\n").unwrap();
        git(repo.path(), &["commit", "-am", "second"]);
        fs::write(repo.path().join("file.txt"), "staged change\n").unwrap();
        git(repo.path(), &["add", "file.txt"]);
        fs::write(repo.path().join("file.txt"), "unstaged change\n").unwrap();
        (repo, target)
    }

    fn git_allow_failure(repo: &Path, args: &[&str]) -> CommandOutput {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .unwrap();
        CommandOutput {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        }
    }

    struct CommandOutput {
        success: bool,
        stdout: String,
        stderr: String,
    }

    #[test]
    fn resolves_longest_matching_remote_prefix() {
        assert_eq!(
            split_remote_branch_name("origin\norigin/team\n", "origin/team/feature/ui"),
            Ok(["origin/team".to_string(), "feature/ui".to_string()])
        );
    }

    #[test]
    fn rejects_names_that_are_not_remote_branches() {
        assert!(split_remote_branch_name("origin\n", "other/feature").is_err());
        assert!(split_remote_branch_name("origin\n", "origin/").is_err());
    }

    #[test]
    fn creates_and_deletes_tag_on_selected_commit() {
        let repo = TestRepo::new();
        fs::write(repo.path().join("file.txt"), "first\n").unwrap();
        git(repo.path(), &["add", "file.txt"]);
        git(repo.path(), &["commit", "-m", "first"]);
        let first_commit = git(repo.path(), &["rev-parse", "HEAD"]);

        fs::write(repo.path().join("file.txt"), "second\n").unwrap();
        git(repo.path(), &["commit", "-am", "second"]);

        create_tag(repo.path(), "older-release", Some(&first_commit), None).unwrap();
        assert_eq!(
            git(repo.path(), &["rev-list", "-n", "1", "older-release"]),
            first_commit
        );

        delete_tag(repo.path(), "older-release").unwrap();
        assert!(
            Command::new("git")
                .arg("-C")
                .arg(repo.path())
                .args(["rev-parse", "--verify", "--quiet", "refs/tags/older-release"])
                .status()
                .unwrap()
                .success()
                == false
        );
    }

    #[test]
    fn stages_and_unstages_individual_hunks() {
        let repo = TestRepo::new();
        let original = (1..=16)
            .map(|line| format!("line {line}\n"))
            .collect::<String>();
        fs::write(repo.path().join("file.txt"), &original).unwrap();
        git(repo.path(), &["add", "file.txt"]);
        git(repo.path(), &["commit", "-m", "base"]);

        let changed = original
            .replace("line 2\n", "changed two\n")
            .replace("line 14\n", "changed fourteen\n");
        fs::write(repo.path().join("file.txt"), changed).unwrap();

        let hunks = file_hunks(repo.path(), "file.txt", false).unwrap();
        assert_eq!(hunks.len(), 2);
        apply_file_hunk(repo.path(), "file.txt", false, &hunks[0].patch).unwrap();
        let staged = git(repo.path(), &["diff", "--cached", "--", "file.txt"]);
        assert!(staged.contains("+changed two"));
        assert!(!staged.contains("+changed fourteen"));
        assert!(apply_file_hunk(repo.path(), "file.txt", false, &hunks[0].patch).is_err());

        let staged_hunk = file_hunks(repo.path(), "file.txt", true).unwrap();
        assert_eq!(staged_hunk.len(), 1);
        apply_file_hunk(repo.path(), "file.txt", true, &staged_hunk[0].patch).unwrap();
        assert!(git(repo.path(), &["diff", "--cached", "--", "file.txt"]).is_empty());
        assert!(git(repo.path(), &["diff", "--", "file.txt"]).contains("+changed two"));
    }

    #[test]
    fn stages_a_hunk_for_an_untracked_file() {
        let repo = TestRepo::new();
        fs::write(repo.path().join("new.txt"), "new content\n").unwrap();

        let hunks = file_hunks(repo.path(), "new.txt", false).unwrap();
        assert_eq!(hunks.len(), 1);
        apply_file_hunk(repo.path(), "new.txt", false, &hunks[0].patch).unwrap();
        assert!(git(repo.path(), &["diff", "--cached", "--", "new.txt"]).contains("+new content"));
    }

    #[test]
    fn cherry_picks_commit_into_current_branch() {
        let repo = TestRepo::new();
        fs::write(repo.path().join("base.txt"), "base\n").unwrap();
        git(repo.path(), &["add", "base.txt"]);
        git(repo.path(), &["commit", "-m", "base"]);
        let base_branch = git(repo.path(), &["branch", "--show-current"]);
        git(repo.path(), &["checkout", "-b", "feature"]);
        fs::write(repo.path().join("feature.txt"), "feature\n").unwrap();
        git(repo.path(), &["add", "feature.txt"]);
        git(repo.path(), &["commit", "-m", "feature change"]);
        let feature_commit = git(repo.path(), &["rev-parse", "HEAD"]);
        git(repo.path(), &["checkout", &base_branch]);

        cherry_pick_commit(repo.path(), &feature_commit).unwrap();
        assert_eq!(git(repo.path(), &["show", "HEAD:feature.txt"]), "feature");
        assert_eq!(
            git(repo.path(), &["log", "-1", "--format=%s"]),
            "feature change"
        );
    }

    #[test]
    fn reverts_commit_with_generated_message() {
        let repo = TestRepo::new();
        fs::write(repo.path().join("base.txt"), "base\n").unwrap();
        git(repo.path(), &["add", "base.txt"]);
        git(repo.path(), &["commit", "-m", "base"]);
        fs::write(repo.path().join("base.txt"), "changed\n").unwrap();
        git(repo.path(), &["commit", "-am", "change"]);
        let changed_commit = git(repo.path(), &["rev-parse", "HEAD"]);

        revert_commit(repo.path(), &changed_commit).unwrap();
        assert_eq!(git(repo.path(), &["show", "HEAD:base.txt"]), "base");
        assert!(git(repo.path(), &["log", "-1", "--format=%s"]).starts_with("Revert \"change\""));
    }

    #[test]
    fn soft_reset_moves_head_and_keeps_index_and_worktree() {
        let (repo, target) = repo_with_two_commits();
        reset_to_commit(repo.path(), &target, "soft").unwrap();

        assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), target);
        assert_eq!(git(repo.path(), &["show", ":file.txt"]), "staged change");
        assert_eq!(
            fs::read_to_string(repo.path().join("file.txt")).unwrap(),
            "unstaged change\n"
        );
    }

    #[test]
    fn mixed_reset_moves_head_and_index_but_keeps_worktree() {
        let (repo, target) = repo_with_two_commits();
        reset_to_commit(repo.path(), &target, "mixed").unwrap();

        assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), target);
        assert_eq!(git(repo.path(), &["show", ":file.txt"]), "base");
        assert_eq!(
            fs::read_to_string(repo.path().join("file.txt")).unwrap(),
            "unstaged change\n"
        );
    }

    #[test]
    fn hard_reset_moves_head_index_and_worktree_to_target() {
        let (repo, target) = repo_with_two_commits();
        reset_to_commit(repo.path(), &target, "hard").unwrap();

        assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), target);
        assert_eq!(git(repo.path(), &["show", ":file.txt"]), "base");
        assert_eq!(
            fs::read_to_string(repo.path().join("file.txt")).unwrap(),
            "base\n"
        );
    }

    #[test]
    fn reset_rejects_invalid_modes_and_revisions() {
        let (repo, target) = repo_with_two_commits();
        assert!(reset_to_commit(repo.path(), &target, "invalid").is_err());
        assert!(reset_to_commit(repo.path(), "not-a-commit", "mixed").is_err());
        assert_ne!(git(repo.path(), &["rev-parse", "HEAD"]), target);
    }

    #[test]
    fn manually_resolves_and_stages_conflict_file() {
        let repo = TestRepo::new();
        fs::write(repo.path().join("conflict.txt"), "base\n").unwrap();
        git(repo.path(), &["add", "conflict.txt"]);
        git(repo.path(), &["commit", "-m", "base"]);
        let base_branch = git(repo.path(), &["branch", "--show-current"]);
        git(repo.path(), &["checkout", "-b", "other"]);
        fs::write(repo.path().join("conflict.txt"), "other side\n").unwrap();
        git(repo.path(), &["commit", "-am", "other change"]);
        git(repo.path(), &["checkout", &base_branch]);
        fs::write(repo.path().join("conflict.txt"), "current side\n").unwrap();
        git(repo.path(), &["commit", "-am", "current change"]);

        let merge = git_allow_failure(repo.path(), &["merge", "other"]);
        assert!(!merge.success);
        assert!(merge.stderr.contains("CONFLICT") || merge.stdout.contains("CONFLICT"));
        assert!(conflict_file_content(repo.path(), "conflict.txt")
            .unwrap()
            .contains("<<<<<<<"));

        resolve_conflict_manually(repo.path(), "conflict.txt", "resolved content\n").unwrap();
        assert_eq!(
            fs::read_to_string(repo.path().join("conflict.txt")).unwrap(),
            "resolved content\n"
        );
        assert!(git(repo.path(), &["ls-files", "-u", "--", "conflict.txt"]).is_empty());
        assert_eq!(
            git(repo.path(), &["show", ":conflict.txt"]),
            "resolved content"
        );
    }

    #[test]
    fn manual_conflict_resolution_rejects_paths_outside_repository() {
        let repo = TestRepo::new();
        assert!(conflict_file_content(repo.path(), "../outside.txt").is_err());
        assert!(resolve_conflict_manually(repo.path(), "../outside.txt", "unsafe").is_err());
    }

    #[test]
    fn adds_updates_and_removes_remote() {
        let repo = TestRepo::new();
        add_remote(repo.path(), "origin", "https://example.test/first.git").unwrap();
        assert_eq!(
            git(repo.path(), &["remote", "get-url", "origin"]),
            "https://example.test/first.git"
        );
        set_remote_url(repo.path(), "origin", "https://example.test/second.git").unwrap();
        assert_eq!(
            git(repo.path(), &["remote", "get-url", "origin"]),
            "https://example.test/second.git"
        );
        remove_remote(repo.path(), "origin").unwrap();
        assert!(git(repo.path(), &["remote"]).is_empty());
    }

    #[test]
    fn sets_and_clears_local_branch_upstream() {
        let repo = TestRepo::new();
        fs::write(repo.path().join("file.txt"), "base\n").unwrap();
        git(repo.path(), &["add", "file.txt"]);
        git(repo.path(), &["commit", "-m", "base"]);
        let branch = git(repo.path(), &["branch", "--show-current"]);
        add_remote(repo.path(), "origin", "https://example.test/repo.git").unwrap();
        git(
            repo.path(),
            &["update-ref", "refs/remotes/origin/main", "HEAD"],
        );

        set_upstream(repo.path(), &branch, Some("origin/main")).unwrap();
        assert_eq!(
            git(
                repo.path(),
                &[
                    "for-each-ref",
                    "--format=%(upstream:short)",
                    &format!("refs/heads/{branch}")
                ]
            ),
            "origin/main"
        );
        set_upstream(repo.path(), &branch, None).unwrap();
        set_upstream(repo.path(), &branch, None).unwrap();
        assert!(
            git(
                repo.path(),
                &[
                    "for-each-ref",
                    "--format=%(upstream:short)",
                    &format!("refs/heads/{branch}")
                ]
            )
            .is_empty()
        );
    }

    #[test]
    fn pushes_current_branch_to_selected_remote_and_rejects_detached_head() {
        let local_repo = TestRepo::new();
        git(local_repo.path(), &["init", "--bare", "remote.git"]);
        let remote_path = local_repo.path().join("remote.git");
        fs::write(local_repo.path().join("file.txt"), "content\n").unwrap();
        git(local_repo.path(), &["add", "file.txt"]);
        git(local_repo.path(), &["commit", "-m", "base"]);
        let branch = git(local_repo.path(), &["branch", "--show-current"]);
        add_remote(
            local_repo.path(),
            "destination",
            &remote_path.to_string_lossy(),
        )
        .unwrap();

        push_remote(local_repo.path(), "destination", None, false).unwrap();
        let remote_ref = format!("refs/heads/{branch}");
        let remote_hash = git(
            local_repo.path(),
            &["ls-remote", "destination", &remote_ref],
        )
        .split_whitespace()
        .next()
        .unwrap()
        .to_string();
        assert_eq!(
            remote_hash,
            git(local_repo.path(), &["rev-parse", "HEAD"])
        );
        fetch_remote(local_repo.path(), "destination", None, true).unwrap();
        assert_eq!(
            git(
                local_repo.path(),
                &[
                    "rev-parse",
                    &format!("refs/remotes/destination/{branch}")
                ]
            ),
            git(local_repo.path(), &["rev-parse", "HEAD"])
        );
        let head = git(local_repo.path(), &["rev-parse", "HEAD"]);
        git(local_repo.path(), &["checkout", "--detach", &head]);
        assert!(push_remote(local_repo.path(), "destination", None, false).is_err());
    }

    #[test]
    fn fetch_pruning_option_removes_only_stale_tracking_refs_when_enabled() {
        let local_repo = TestRepo::new();
        git(local_repo.path(), &["init", "--bare", "remote.git"]);
        let remote_path = local_repo.path().join("remote.git");
        fs::write(local_repo.path().join("file.txt"), "content\n").unwrap();
        git(local_repo.path(), &["add", "file.txt"]);
        git(local_repo.path(), &["commit", "-m", "base"]);
        git(local_repo.path(), &["branch", "stale"]);
        add_remote(
            local_repo.path(),
            "destination",
            &remote_path.to_string_lossy(),
        )
        .unwrap();
        push_remote(local_repo.path(), "destination", None, false).unwrap();
        git(
            local_repo.path(),
            &["push", "destination", "stale:refs/heads/stale"],
        );
        let remote_refs = git(local_repo.path(), &["ls-remote", "destination"]);
        assert!(remote_refs.contains("refs/heads/stale"), "{remote_refs}");
        let fetch_output = fetch_remote(local_repo.path(), "destination", None, true).unwrap();
        let tracking_ref = "refs/remotes/destination/stale";
        assert!(
            git_allow_failure(local_repo.path(), &["show-ref", "--verify", tracking_ref]).success,
            "fetch output: {fetch_output}; refs: {}",
            git(local_repo.path(), &["show-ref"])
        );

        git(local_repo.path(), &["clone", "remote.git", "peer"]);
        let peer_path = local_repo.path().join("peer");
        git(&peer_path, &["push", "origin", "--delete", "stale"]);
        fetch_remote(local_repo.path(), "destination", None, false).unwrap();
        assert!(git_allow_failure(local_repo.path(), &["show-ref", "--verify", tracking_ref]).success);

        fetch_remote(local_repo.path(), "destination", None, true).unwrap();
        assert!(!git_allow_failure(local_repo.path(), &["show-ref", "--verify", tracking_ref]).success);
    }

    #[test]
    fn force_with_lease_refuses_to_overwrite_a_remote_change() {
        let local_repo = TestRepo::new();
        git(local_repo.path(), &["init", "--bare", "remote.git"]);
        let remote_path = local_repo.path().join("remote.git");
        fs::write(local_repo.path().join("file.txt"), "base\n").unwrap();
        git(local_repo.path(), &["add", "file.txt"]);
        git(local_repo.path(), &["commit", "-m", "base"]);
        let branch = git(local_repo.path(), &["branch", "--show-current"]);
        add_remote(
            local_repo.path(),
            "destination",
            &remote_path.to_string_lossy(),
        )
        .unwrap();
        push_remote(local_repo.path(), "destination", None, false).unwrap();
        fetch_remote(local_repo.path(), "destination", None, false).unwrap();

        let peer_path = local_repo.path().join("peer");
        git(local_repo.path(), &["clone", "remote.git", "peer"]);
        git(&peer_path, &["config", "user.name", "Peer"]);
        git(&peer_path, &["config", "user.email", "peer@example.com"]);
        fs::write(peer_path.join("peer.txt"), "remote update\n").unwrap();
        git(&peer_path, &["add", "peer.txt"]);
        git(&peer_path, &["commit", "-m", "remote update"]);
        let peer_head = git(&peer_path, &["rev-parse", "HEAD"]);
        git(&peer_path, &["push", "origin", &format!("HEAD:refs/heads/{branch}")]);

        fs::write(local_repo.path().join("local.txt"), "local update\n").unwrap();
        git(local_repo.path(), &["add", "local.txt"]);
        git(local_repo.path(), &["commit", "-m", "local update"]);
        let local_head = git(local_repo.path(), &["rev-parse", "HEAD"]);
        let result = push_remote(local_repo.path(), "destination", None, true);

        assert!(result.is_err());
        assert_eq!(git(local_repo.path(), &["rev-parse", "HEAD"]), local_head);
        let remote_head = git(
            local_repo.path(),
            &["ls-remote", "destination", &format!("refs/heads/{branch}")],
        )
        .split_whitespace()
        .next()
        .unwrap()
        .to_string();
        assert_eq!(remote_head, peer_head);
    }

    #[test]
    fn pushes_all_local_tags_without_pushing_branches() {
        let local_repo = TestRepo::new();
        git(local_repo.path(), &["init", "--bare", "remote.git"]);
        let remote_path = local_repo.path().join("remote.git");
        fs::write(local_repo.path().join("file.txt"), "content\n").unwrap();
        git(local_repo.path(), &["add", "file.txt"]);
        git(local_repo.path(), &["commit", "-m", "base"]);
        let commit = git(local_repo.path(), &["rev-parse", "HEAD"]);
        git(local_repo.path(), &["tag", "v1.0"]);
        git(
            local_repo.path(),
            &["tag", "-a", "v1.1", "-m", "release 1.1"],
        );
        add_remote(
            local_repo.path(),
            "destination",
            &remote_path.to_string_lossy(),
        )
        .unwrap();

        push_tags(local_repo.path(), "destination", None).unwrap();

        for tag in ["v1.0", "v1.1"] {
            let refname = format!("refs/tags/{tag}");
            let remote_hash = git(
                local_repo.path(),
                &["ls-remote", "destination", &refname],
            )
            .split_whitespace()
            .next()
            .unwrap()
            .to_string();
            if tag == "v1.0" {
                assert_eq!(remote_hash, commit);
            } else {
                assert!(!remote_hash.is_empty());
            }
        }
        assert!(
            git(local_repo.path(), &["ls-remote", "destination", "refs/heads/*"]).is_empty()
        );
    }

    #[test]
    fn creates_lists_and_removes_linked_worktree() {
        let repo = TestRepo::new();
        fs::write(repo.path().join("base.txt"), "base\n").unwrap();
        git(repo.path(), &["add", "base.txt"]);
        git(repo.path(), &["commit", "-m", "base"]);
        let current_path = fs::canonicalize(repo.path()).unwrap();
        let destination = repo.path().join("linked-worktree");

        add_worktree(
            repo.path(),
            destination.to_str().unwrap(),
            "HEAD",
            Some("worktree-feature"),
        )
        .unwrap();

        let listed = worktrees(repo.path()).unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().any(|entry| entry.is_current && Path::new(&entry.path) == current_path));
        let linked = listed
            .iter()
            .find(|entry| entry.path == destination.to_string_lossy())
            .unwrap();
        assert_eq!(linked.branch.as_deref(), Some("worktree-feature"));
        assert!(!linked.is_detached);
        assert!(remove_worktree(repo.path(), repo.path().to_str().unwrap()).is_err());

        remove_worktree(repo.path(), destination.to_str().unwrap()).unwrap();
        assert_eq!(worktrees(repo.path()).unwrap().len(), 1);
        assert!(!destination.exists());
    }

    #[test]
    fn refuses_to_remove_worktree_with_uncommitted_changes() {
        let repo = TestRepo::new();
        fs::write(repo.path().join("base.txt"), "base\n").unwrap();
        git(repo.path(), &["add", "base.txt"]);
        git(repo.path(), &["commit", "-m", "base"]);
        let destination = repo.path().join("dirty-worktree");
        add_worktree(
            repo.path(),
            destination.to_str().unwrap(),
            "HEAD",
            Some("dirty-feature"),
        )
        .unwrap();
        fs::write(destination.join("changed.txt"), "uncommitted\n").unwrap();

        assert!(remove_worktree(repo.path(), destination.to_str().unwrap()).is_err());
        assert!(destination.exists());
    }

    #[test]
    fn reflog_entries_can_recover_a_commit_as_a_new_branch() {
        let repo = TestRepo::new();
        fs::write(repo.path().join("history.txt"), "first\n").unwrap();
        git(repo.path(), &["add", "history.txt"]);
        git(repo.path(), &["commit", "-m", "first"]);
        let recoverable = git(repo.path(), &["rev-parse", "HEAD"]);
        fs::write(repo.path().join("history.txt"), "second\n").unwrap();
        git(repo.path(), &["commit", "-am", "second"]);
        git(repo.path(), &["reset", "--hard", &recoverable]);

        let entries = reflog(repo.path(), 20).unwrap();
        assert!(entries.iter().any(|entry| entry.commit_id == recoverable));
        assert!(entries.iter().any(|entry| entry.action.contains("reset")));

        recover_branch_at_commit(repo.path(), "recovered-commit", &recoverable).unwrap();
        assert_eq!(
            git(repo.path(), &["rev-parse", "refs/heads/recovered-commit"]),
            recoverable
        );
        assert!(recover_branch_at_commit(repo.path(), "bad name", &recoverable).is_err());
        assert!(recover_branch_at_commit(repo.path(), "another", "not-a-commit").is_err());
    }

    #[test]
    fn empty_repository_has_no_reflog_entries() {
        let repo = TestRepo::new();
        assert!(reflog(repo.path(), 20).unwrap().is_empty());
    }

    #[test]
    fn pull_rejects_invalid_strategy_and_incomplete_source() {
        let repo = TestRepo::new();
        assert!(pull(repo.path(), None, None, "invalid", None).is_err());
        assert!(pull(repo.path(), Some("origin"), None, "merge", None).is_err());
    }
}
