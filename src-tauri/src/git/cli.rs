//! Mutating git operations shell out to the `git` CLI so hooks,
//! config, aliases and edge cases behave exactly like the terminal.

use std::ffi::OsStr;
use std::path::Path;
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

fn run_str(repo: &Path, args: &[&str]) -> Result<String, String> {
    run(repo, args)
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

pub fn create_tag(repo: &Path, name: &str, message: Option<String>) -> Result<(), String> {
    match message {
        Some(msg) if !msg.trim().is_empty() => {
            run_str(repo, &["tag", "-a", name, "-m", msg.trim()]).map(|_| ())
        }
        _ => run_str(repo, &["tag", name]).map(|_| ()),
    }
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

pub fn fetch_all(repo: &Path) -> Result<String, String> {
    run_net(repo, &["fetch", "--all", "--prune"])
}

pub fn pull(repo: &Path) -> Result<String, String> {
    run_net(repo, &["pull"])
}

pub fn push(repo: &Path) -> Result<String, String> {
    run_net(repo, &["push"])
}
