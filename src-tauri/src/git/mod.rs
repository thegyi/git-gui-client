//! Git read operations powered by git2 (libgit2).
//! Mutations live in `cli` and shell out to the `git` binary so that
//! hooks, config and edge cases behave exactly like the CLI.

use git2::{BranchType, Commit, ObjectType, Oid, Repository, Sort, Status, StatusOptions};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

pub mod cli;

pub fn open(path: &str) -> Result<Repository, String> {
    Repository::open(path).map_err(|e| format!("cannot open repository at {path}: {e}"))
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub is_bare: bool,
    pub branch: Option<String>,
    pub detached: bool,
    /// URL of the `origin` remote (or first remote if no origin).
    pub remote_url: Option<String>,
    /// Repository state: "clean" | "merge" | "revert" | "cherry-pick" |
    /// "bisect" | "rebase" | "other".
    pub state: String,
    /// True when a remote matches the configured self-hosted GitLab.
    pub gitlab_matched: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub old_path: Option<String>,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub index_status: String,
    pub workdir_status: String,
    pub conflicted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub time: i64,
    pub message: String,
    pub refs: Vec<RefBadge>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RefBadge {
    pub name: String,
    /// "branch" | "remote" | "tag" | "head"
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub last_commit_id: String,
    pub last_commit_time: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    pub is_annotated: bool,
    pub target_id: String,
    pub time: i64,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub old_content: String,
    pub new_content: String,
    pub old_exists: bool,
    pub new_exists: bool,
    pub is_binary: bool,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitChange {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffStats {
    pub files: u32,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub id: String,
    pub short_id: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub committer_name: String,
    pub committer_email: String,
    pub time: i64,
    pub commit_time: i64,
    pub message: String,
    pub refs: Vec<RefBadge>,
    pub stats: DiffStats,
    pub changes: Vec<CommitChange>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_CONTENT: usize = 1_000_000;

fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8192).any(|&b| b == 0)
}

fn to_text(bytes: &[u8]) -> (String, bool) {
    let truncated = bytes.len() > MAX_CONTENT;
    let slice = if truncated { &bytes[..MAX_CONTENT] } else { bytes };
    (String::from_utf8_lossy(slice).into_owned(), truncated)
}

fn blob_bytes(repo: &Repository, oid: Oid) -> Result<Vec<u8>, String> {
    let blob = repo.find_blob(oid).map_err(err)?;
    Ok(blob.content().to_vec())
}

/// Blob content at a path inside a tree-ish commit.
fn content_in_commit(repo: &Repository, commit: &Commit, path: &str) -> Result<Option<Vec<u8>>, String> {
    let tree = commit.tree().map_err(err)?;
    match tree.get_path(Path::new(path)) {
        Ok(entry) => {
            if entry.kind() == Some(ObjectType::Blob) {
                blob_bytes(repo, entry.id()).map(Some)
            } else {
                Ok(None)
            }
        }
        Err(_) => Ok(None),
    }
}

/// Blob content at a path inside HEAD's tree.
fn content_at_head(repo: &Repository, path: &str) -> Result<Option<Vec<u8>>, String> {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(None), // unborn branch
    };
    let commit = head.peel_to_commit().map_err(err)?;
    content_in_commit(repo, &commit, path)
}

/// Blob content at a path inside the index.
fn content_in_index(repo: &Repository, path: &str) -> Result<Option<Vec<u8>>, String> {
    let index = repo.index().map_err(err)?;
    match index.get_path(Path::new(path), 0) {
        Some(entry) => blob_bytes(repo, entry.id).map(Some),
        None => Ok(None),
    }
}

fn content_at_workdir(repo: &Repository, path: &str) -> Option<Vec<u8>> {
    let full = repo.workdir()?.join(path);
    std::fs::read(full).ok()
}

fn make_diff(old: Option<Vec<u8>>, new: Option<Vec<u8>>) -> FileDiff {
    let old_exists = old.is_some();
    let new_exists = new.is_some();
    let old_b = old.unwrap_or_default();
    let new_b = new.unwrap_or_default();
    let is_binary = is_binary(&old_b) || is_binary(&new_b);
    let (old_content, t1) = to_text(&old_b);
    let (new_content, t2) = to_text(&new_b);
    FileDiff {
        old_content,
        new_content,
        old_exists,
        new_exists,
        is_binary,
        truncated: t1 || t2,
    }
}

// ---------------------------------------------------------------------------
// Repo / status / log
// ---------------------------------------------------------------------------

/// URL of the `origin` remote, falling back to the first configured remote.
fn primary_remote_url(repo: &Repository) -> Option<String> {
    if let Ok(remote) = repo.find_remote("origin") {
        if let Some(url) = remote.url() {
            return Some(url.to_string());
        }
    }
    let names = repo.remotes().ok()?;
    names.iter().flatten().find_map(|name| {
        repo.find_remote(name)
            .ok()
            .and_then(|r| r.url().map(|u| u.to_string()))
    })
}

pub fn repo_info(repo: &Repository) -> RepoInfo {
    let path = repo
        .workdir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| repo.path().to_string_lossy().into_owned());
    let name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());
    let (branch, detached) = match repo.head() {
        Ok(head) => {
            if head.is_branch() {
                (
                    head.shorthand().map(|s| s.to_string()),
                    false,
                )
            } else {
                (None, true)
            }
        }
        Err(_) => (None, false), // unborn HEAD
    };
    RepoInfo {
        path,
        name,
        is_bare: repo.is_bare(),
        branch,
        detached,
        remote_url: primary_remote_url(repo),
        state: repo_state(repo),
        gitlab_matched: false,
    }
}

fn repo_state(repo: &Repository) -> String {
    use git2::RepositoryState as S;
    match repo.state() {
        S::Clean => "clean",
        S::Merge => "merge",
        S::Revert => "revert",
        S::CherryPick => "cherry-pick",
        S::Bisect => "bisect",
        S::RebaseMerge | S::RebaseInteractive => "rebase",
        _ => "other",
    }
    .to_string()
}

fn index_status_char(s: Status) -> char {
    if s.contains(Status::INDEX_NEW) {
        'A'
    } else if s.contains(Status::INDEX_MODIFIED) {
        'M'
    } else if s.contains(Status::INDEX_DELETED) {
        'D'
    } else if s.contains(Status::INDEX_RENAMED) {
        'R'
    } else if s.contains(Status::INDEX_TYPECHANGE) {
        'T'
    } else {
        ' '
    }
}

fn workdir_status_char(s: Status) -> char {
    if s.contains(Status::WT_TYPECHANGE) {
        'T'
    } else if s.contains(Status::WT_MODIFIED) {
        'M'
    } else if s.contains(Status::WT_DELETED) {
        'D'
    } else if s.contains(Status::WT_RENAMED) {
        'R'
    } else if s.contains(Status::WT_NEW) {
        '?'
    } else {
        ' '
    }
}

pub fn status(repo: &Repository) -> Result<Vec<FileStatus>, String> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(err)?;

    let mut out = Vec::new();
    for entry in statuses.iter() {
        let s = entry.status();
        let Some(path) = entry.path().map(|p| p.to_string()) else {
            continue;
        };
        let staged = s.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        );
        let untracked = s.contains(Status::WT_NEW);
        let unstaged = s.intersects(
            Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_TYPECHANGE | Status::WT_RENAMED,
        );
        let old_path = entry
            .head_to_index()
            .and_then(|d| d.old_file().path().map(|p| p.to_string_lossy().into_owned()))
            .or_else(|| {
                entry
                    .index_to_workdir()
                    .and_then(|d| d.old_file().path().map(|p| p.to_string_lossy().into_owned()))
            })
            .filter(|p| *p != path);
        out.push(FileStatus {
            path,
            old_path,
            staged,
            unstaged,
            untracked,
            index_status: index_status_char(s).to_string(),
            workdir_status: workdir_status_char(s).to_string(),
            conflicted: s.contains(Status::CONFLICTED),
        });
    }
    Ok(out)
}

/// Map commit oid -> ref badges (branches, remote branches, tags, HEAD).
fn refs_map(repo: &Repository) -> HashMap<Oid, Vec<RefBadge>> {
    let mut map: HashMap<Oid, Vec<RefBadge>> = HashMap::new();

    let mut push = |oid: Oid, badge: RefBadge| {
        if let Some(v) = map.get_mut(&oid) {
            v.push(badge);
        } else {
            map.insert(oid, vec![badge]);
        }
    };

    if let Ok(branches) = repo.branches(None) {
        for b in branches.flatten() {
            let (branch, branch_type) = b;
            let Ok(name) = branch.name() else { continue };
            let Some(name) = name else { continue };
            let Some(oid) = branch.get().target() else { continue };
            let kind = match branch_type {
                BranchType::Local => "branch",
                BranchType::Remote => "remote",
            };
            push(
                oid,
                RefBadge {
                    name: name.to_string(),
                    kind: kind.to_string(),
                },
            );
        }
    }

    if let Ok(names) = repo.tag_names(None) {
        for name in names.iter().flatten() {
            // Peel annotated tags to their commit.
            if let Ok(obj) = repo.revparse_single(&format!("refs/tags/{name}^{{commit}}")) {
                if let Ok(commit) = obj.into_commit() {
                    push(
                        commit.id(),
                        RefBadge {
                            name: name.to_string(),
                            kind: "tag".to_string(),
                        },
                    );
                }
            }
        }
    }

    if let Ok(head) = repo.head() {
        if let Some(oid) = head.target() {
            if head.is_branch() {
                // HEAD badge is implied by the branch badge; add explicit marker anyway.
                push(
                    oid,
                    RefBadge {
                        name: "HEAD".to_string(),
                        kind: "head".to_string(),
                    },
                );
            }
        }
    }

    map
}

fn commit_info(_repo: &Repository, commit: &Commit, refs: &HashMap<Oid, Vec<RefBadge>>) -> CommitInfo {
    let id = commit.id();
    let id_str = id.to_string();
    CommitInfo {
        id: id_str.clone(),
        short_id: id_str[..id_str.len().min(7)].to_string(),
        parents: commit.parent_ids().map(|p| p.to_string()).collect(),
        author_name: commit.author().name().unwrap_or("").to_string(),
        author_email: commit.author().email().unwrap_or("").to_string(),
        time: commit.time().seconds(),
        message: commit.message().unwrap_or("").trim().to_string(),
        refs: refs.get(&id).cloned().unwrap_or_default(),
    }
}

pub fn log(repo: &Repository, limit: usize) -> Result<Vec<CommitInfo>, String> {
    let mut revwalk = repo.revwalk().map_err(err)?;
    revwalk.push_head().map_err(err)?;
    revwalk.set_sorting(Sort::TIME).map_err(err)?;
    let refs = refs_map(repo);

    let mut out = Vec::new();
    for oid in revwalk.take(limit) {
        let oid = oid.map_err(err)?;
        let commit = repo.find_commit(oid).map_err(err)?;
        out.push(commit_info(repo, &commit, &refs));
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Branches / tags
// ---------------------------------------------------------------------------

pub fn branches(repo: &Repository) -> Result<Vec<BranchInfo>, String> {
    let mut out = Vec::new();
    for b in repo.branches(None).map_err(err)? {
        let (branch, branch_type) = b.map_err(err)?;
        let name = branch.name().map_err(err)?.unwrap_or_default().to_string();
        if name.is_empty() || name.ends_with("/HEAD") {
            continue;
        }
        let is_remote = branch_type == BranchType::Remote;
        let target = branch.get().target();
        let (last_commit_id, last_commit_time) = match target.and_then(|oid| repo.find_commit(oid).ok()) {
            Some(c) => (c.id().to_string(), c.time().seconds()),
            None => (String::new(), 0),
        };
        let upstream = if is_remote {
            None
        } else {
            repo.branch_upstream_name(&name)
                .ok()
                .map(|buf| buf.as_str().unwrap_or("").to_string())
                .filter(|s| !s.is_empty())
        };
        out.push(BranchInfo {
            name,
            is_head: branch.is_head(),
            is_remote,
            upstream,
            last_commit_id,
            last_commit_time,
        });
    }
    // Local branches first (most recent first), then remotes.
    out.sort_by(|a, b| {
        a.is_remote
            .cmp(&b.is_remote)
            .then(b.last_commit_time.cmp(&a.last_commit_time))
            .then(a.name.cmp(&b.name))
    });
    Ok(out)
}

pub fn tags(repo: &Repository) -> Result<Vec<TagInfo>, String> {
    let names = repo.tag_names(None).map_err(err)?;
    let mut out = Vec::new();
    for name in names.iter().flatten() {
        let refname = format!("refs/tags/{name}");
        // The object a tag ref points at directly is a tag object only for
        // annotated tags; lightweight tags point straight at a commit.
        let direct = repo.revparse_single(&refname).ok();
        let is_annotated = direct
            .as_ref()
            .map(|o| o.kind() == Some(ObjectType::Tag))
            .unwrap_or(false);
        let tag_message = if is_annotated {
            direct
                .as_ref()
                .and_then(|o| repo.find_tag(o.id()).ok())
                .and_then(|t| t.message().map(|m| m.trim().to_string()))
                .unwrap_or_default()
        } else {
            String::new()
        };
        // Peel to the underlying commit for id + time.
        let (target_id, time, message) = match repo.revparse_single(&format!("{refname}^{{commit}}")) {
            Ok(obj) => match obj.into_commit() {
                Ok(c) => (c.id().to_string(), c.time().seconds(), tag_message),
                Err(_) => (String::new(), 0, String::new()),
            },
            Err(_) => (String::new(), 0, String::new()),
        };
        out.push(TagInfo {
            name: name.to_string(),
            is_annotated,
            target_id,
            time,
            message,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

// ---------------------------------------------------------------------------
// Diffs
// ---------------------------------------------------------------------------

/// Diff for a working-tree file.
/// staged=true  -> HEAD vs index
/// staged=false -> index vs workdir
pub fn workdir_file_diff(repo: &Repository, path: &str, staged: bool) -> Result<FileDiff, String> {
    let (old, new) = if staged {
        (content_at_head(repo, path)?, content_in_index(repo, path)?)
    } else {
        let old = match content_in_index(repo, path)? {
            Some(b) => Some(b),
            None => content_at_head(repo, path)?,
        };
        (old, content_at_workdir(repo, path))
    };
    Ok(make_diff(old, new))
}

/// Diff for a file changed by a commit (vs its first parent).
pub fn commit_file_diff(repo: &Repository, hash: &str, path: &str) -> Result<FileDiff, String> {
    let oid = Oid::from_str(hash).map_err(|_| format!("invalid commit id: {hash}"))?;
    let commit = repo.find_commit(oid).map_err(err)?;
    let new = content_in_commit(repo, &commit, path)?;
    let old = match commit.parent(0) {
        Ok(parent) => content_in_commit(repo, &parent, path)?,
        Err(_) => None, // root commit
    };
    Ok(make_diff(old, new))
}

fn delta_status_char(status: git2::Delta) -> &'static str {
    use git2::Delta::*;
    match status {
        Added => "A",
        Deleted => "D",
        Modified => "M",
        Renamed => "R",
        Copied => "C",
        Ignored => "!",
        Untracked => "?",
        Typechange => "T",
        Unreadable => "U",
        Conflicted => "U",
        Unmodified => "-",
    }
}

/// Commit details + per-file changes with +/- stats.
pub fn commit_details(repo: &Repository, hash: &str) -> Result<CommitDetails, String> {
    let oid = Oid::from_str(hash).map_err(|_| format!("invalid commit id: {hash}"))?;
    let commit = repo.find_commit(oid).map_err(err)?;
    let refs = refs_map(repo);

    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
    let tree = commit.tree().map_err(err)?;

    let mut diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
        .map_err(err)?;

    // Rename detection is a post-processing step on the diff.
    let mut find_opts = git2::DiffFindOptions::new();
    find_opts.renames(true).renames_from_rewrites(true);
    diff.find_similar(Some(&mut find_opts)).map_err(err)?;

    // Extract delta info up-front: DiffDelta borrows `diff`, and we need
    // `&mut diff` for `foreach` below.
    struct DeltaInfo {
        old_path: String,
        new_path: String,
        status: git2::Delta,
    }
    let delta_infos: Vec<DeltaInfo> = diff
        .deltas()
        .map(|d| DeltaInfo {
            old_path: d
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
            new_path: d
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
            status: d.status(),
        })
        .collect();

    let delta_index: HashMap<(String, String), usize> = delta_infos
        .iter()
        .enumerate()
        .map(|(i, d)| ((d.old_path.clone(), d.new_path.clone()), i))
        .collect();

    let adds = vec![0u32; delta_infos.len()];
    let dels = vec![0u32; delta_infos.len()];
    let adds_cell = std::cell::RefCell::new(adds);
    let dels_cell = std::cell::RefCell::new(dels);

    diff.foreach(
        &mut |_delta, _progress| true,
        None,
        Some(&mut |_delta, _hunk| true),
        Some(&mut |delta, _hunk, line| {
            let key = (
                delta
                    .old_file()
                    .path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                delta
                    .new_file()
                    .path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default(),
            );
            if let Some(&i) = delta_index.get(&key) {
                match line.origin() {
                    '+' => adds_cell.borrow_mut()[i] += 1,
                    '-' => dels_cell.borrow_mut()[i] += 1,
                    _ => {}
                }
            }
            true
        }),
    )
    .map_err(err)?;

    let mut changes = Vec::new();
    let mut total_adds = 0u32;
    let mut total_dels = 0u32;
    for (i, d) in delta_infos.iter().enumerate() {
        let path = if d.new_path.is_empty() {
            d.old_path.clone()
        } else {
            d.new_path.clone()
        };
        if path.is_empty() {
            continue;
        }
        let old_path = if d.old_path.is_empty() || d.old_path == path {
            None
        } else {
            Some(d.old_path.clone())
        };
        let a = adds_cell.borrow()[i];
        let dl = dels_cell.borrow()[i];
        total_adds += a;
        total_dels += dl;
        changes.push(CommitChange {
            path,
            old_path,
            status: delta_status_char(d.status).to_string(),
            additions: a,
            deletions: dl,
        });
    }

    let info = commit_info(repo, &commit, &refs);
    let committer_name = commit.committer().name().unwrap_or("").to_string();
    let committer_email = commit.committer().email().unwrap_or("").to_string();
    let commit_time = commit.committer().when().seconds();
    Ok(CommitDetails {
        id: info.id,
        short_id: info.short_id,
        parents: info.parents,
        author_name: info.author_name,
        author_email: info.author_email,
        committer_name,
        committer_email,
        time: info.time,
        commit_time,
        message: info.message,
        refs: info.refs,
        stats: DiffStats {
            files: changes.len() as u32,
            additions: total_adds,
            deletions: total_dels,
        },
        changes,
    })
}
