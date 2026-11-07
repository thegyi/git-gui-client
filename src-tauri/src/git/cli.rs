//! Mutating git operations shell out to the `git` CLI so hooks,
//! config, aliases and edge cases behave exactly like the terminal.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

pub fn fetch_all(repo: &Path, auth: Option<&str>) -> Result<String, String> {
    let mut args = Vec::new();
    with_config_args(&mut args, auth);
    args.extend(["fetch", "--all", "--prune"].map(String::from));
    run_net(repo, &args)
}

pub fn pull(repo: &Path, auth: Option<&str>) -> Result<String, String> {
    let mut args = Vec::new();
    with_config_args(&mut args, auth);
    args.push("pull".to_string());
    run_net(repo, &args)
}

pub fn push(repo: &Path, auth: Option<&str>) -> Result<String, String> {
    let mut args = Vec::new();
    with_config_args(&mut args, auth);
    args.push("push".to_string());
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
    use super::{create_tag, delete_tag, split_remote_branch_name};
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
}
