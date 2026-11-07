import { invoke } from '@tauri-apps/api/core';

export interface RepoInfo {
  path: string;
  name: string;
  isBare: boolean;
  branch: string | null;
  detached: boolean;
  remoteUrl: string | null;
  state: string;
  gitlabMatched: boolean;
}

export interface GitlabSettings {
  url: string;
  username: string;
  hasToken: boolean;
}

export interface GitlabProject {
  id: number;
  name: string;
  pathWithNamespace: string;
  description: string | null;
  httpUrlToRepo: string;
  webUrl: string;
}

export interface ReviewLink {
  provider: string;
  url: string;
}

export interface StashInfo {
  index: number;
  message: string;
  time: number;
}

export interface RebaseCommit {
  id: string;
  shortId: string;
  subject: string;
}

export interface RebaseItem {
  id: string;
  action: string;
}

export interface FileStatus {
  path: string;
  oldPath: string | null;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  indexStatus: string;
  workdirStatus: string;
  conflicted: boolean;
}

export interface RefBadge {
  name: string;
  kind: string; // "branch" | "remote" | "tag" | "head"
}

export interface CommitInfo {
  id: string;
  shortId: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  time: number;
  message: string;
  refs: RefBadge[];
}

export interface BranchInfo {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  upstream: string | null;
  lastCommitId: string;
  lastCommitTime: number;
}

export type ResetMode = 'soft' | 'mixed' | 'hard';
export type PullStrategy = 'merge' | 'rebase' | 'ff-only';

export interface RemoteInfo {
  name: string;
  url: string;
  pushUrl: string | null;
}

export interface WorktreeInfo {
  path: string;
  head: string | null;
  branch: string | null;
  isBare: boolean;
  isDetached: boolean;
  isCurrent: boolean;
}

export interface ReflogEntry {
  commitId: string;
  shortId: string;
  selector: string;
  action: string;
  time: number;
}

export interface ComparedCommit {
  id: string;
  shortId: string;
  subject: string;
  authorName: string;
  time: number;
}

export interface BranchComparison {
  base: string;
  compare: string;
  ahead: number;
  behind: number;
  aheadCommits: ComparedCommit[];
  behindCommits: ComparedCommit[];
}

export interface TagInfo {
  name: string;
  isAnnotated: boolean;
  targetId: string;
  time: number;
  message: string;
}

export interface FileDiff {
  oldContent: string;
  newContent: string;
  oldExists: boolean;
  newExists: boolean;
  isBinary: boolean;
  truncated: boolean;
}

export interface FileHunk {
  header: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface CommitChange {
  path: string;
  oldPath: string | null;
  status: string;
  additions: number;
  deletions: number;
}

export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

export interface CommitDetails {
  id: string;
  shortId: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  time: number;
  commitTime: number;
  message: string;
  refs: RefBadge[];
  stats: DiffStats;
  changes: CommitChange[];
}

export const api = {
  openRepo: (path: string) => invoke<RepoInfo>('open_repo', { path }),
  getStatus: (path: string) => invoke<FileStatus[]>('get_status', { path }),
  getLog: (path: string, limit = 300) => invoke<CommitInfo[]>('get_log', { path, limit }),
  getOlderLog: (path: string, after: string, limit = 301) =>
    invoke<CommitInfo[]>('get_older_log', { path, after, limit }),
  getBranches: (path: string) => invoke<BranchInfo[]>('get_branches', { path }),
  getRemotes: (path: string) => invoke<RemoteInfo[]>('get_remotes', { path }),
  getWorktrees: (path: string) => invoke<WorktreeInfo[]>('get_worktrees', { path }),
  getReflog: (path: string, limit = 100) =>
    invoke<ReflogEntry[]>('get_reflog', { path, limit }),
  compareBranches: (path: string, base: string, compare: string) =>
    invoke<BranchComparison>('compare_branches', { path, base, compare }),
  getReviewLink: (path: string, remote: string, branch: string) =>
    invoke<ReviewLink>('get_review_link', { path, remote, branch }),
  getTags: (path: string) => invoke<TagInfo[]>('get_tags', { path }),
  getFileDiff: (path: string, filePath: string, staged: boolean) =>
    invoke<FileDiff>('get_file_diff', { path, filePath, staged }),
  getFileHunks: (path: string, filePath: string, staged: boolean) =>
    invoke<FileHunk[]>('get_file_hunks', { path, filePath, staged }),
  getCommitFileDiff: (path: string, hash: string, filePath: string) =>
    invoke<FileDiff>('get_commit_file_diff', { path, hash, filePath }),
  getCommitDetails: (path: string, hash: string) =>
    invoke<CommitDetails>('get_commit_details', { path, hash }),
  stageFiles: (path: string, files: string[]) => invoke('stage_files', { path, files }),
  unstageFiles: (path: string, files: string[]) => invoke('unstage_files', { path, files }),
  applyFileHunk: (path: string, filePath: string, staged: boolean, patch: string) =>
    invoke('apply_file_hunk', { path, filePath, staged, patch }),
  stageAll: (path: string) => invoke('stage_all', { path }),
  unstageAll: (path: string) => invoke('unstage_all', { path }),
  commit: (path: string, message: string, amend: boolean) =>
    invoke<string>('commit', { path, message, amend }),
  checkoutBranch: (path: string, name: string) => invoke('checkout_branch', { path, name }),
  createBranch: (path: string, name: string, checkout: boolean) =>
    invoke('create_branch', { path, name, checkout }),
  deleteBranch: (path: string, name: string) => invoke('delete_branch', { path, name }),
  addWorktree: (path: string, worktreePath: string, startPoint: string, newBranch?: string) =>
    invoke('add_worktree', { path, worktreePath, startPoint, newBranch: newBranch ?? null }),
  removeWorktree: (path: string, worktreePath: string) =>
    invoke('remove_worktree', { path, worktreePath }),
  recoverBranchAtCommit: (path: string, branch: string, commit: string) =>
    invoke('recover_branch_at_commit', { path, branch, commit }),
  addRemote: (path: string, name: string, url: string) =>
    invoke('add_remote', { path, name, url }),
  setRemoteUrl: (path: string, name: string, url: string) =>
    invoke('set_remote_url', { path, name, url }),
  removeRemote: (path: string, name: string) => invoke('remove_remote', { path, name }),
  setUpstream: (path: string, branch: string, upstream?: string) =>
    invoke('set_upstream', { path, branch, upstream: upstream ?? null }),
  deleteRemoteBranch: (path: string, name: string) =>
    invoke<string>('delete_remote_branch', { path, name }),
  createTag: (path: string, name: string, target?: string, message?: string) =>
    invoke('create_tag', { path, name, target: target ?? null, message: message ?? null }),
  deleteTag: (path: string, name: string) => invoke('delete_tag', { path, name }),
  gitFetch: (path: string, remote?: string, prune = true) =>
    invoke<string>('git_fetch', { path, remote: remote ?? null, prune }),
  gitPull: (path: string, remote?: string, branch?: string, strategy: PullStrategy = 'merge') =>
    invoke<string>('git_pull', {
      path,
      remote: remote ?? null,
      branch: branch ?? null,
      strategy,
    }),
  gitPush: (path: string, remote?: string, forceWithLease = false) =>
    invoke<string>('git_push', { path, remote: remote ?? null, forceWithLease }),
  gitPushTags: (path: string, remote: string) =>
    invoke<string>('git_push_tags', { path, remote }),
  getGitlabSettings: () => invoke<GitlabSettings>('get_gitlab_settings'),
  saveGitlabSettings: (url: string, username: string, token?: string) =>
    invoke('save_gitlab_settings', { url, username, token: token ?? null }),
  clearGitlabSettings: () => invoke('clear_gitlab_settings'),
  testGitlabConnection: (url: string, token?: string) =>
    invoke<string>('test_gitlab_connection', { url, token: token ?? null }),
  getGitlabProjects: (page = 1) =>
    invoke<GitlabProject[]>('get_gitlab_projects', { page }),
  cloneRepo: (url: string, parent: string) =>
    invoke<string>('clone_repo', { url, parent }),
  getStashes: (path: string) => invoke<StashInfo[]>('get_stashes', { path }),
  stashPush: (path: string, message?: string) =>
    invoke<string>('stash_push', { path, message: message ?? null }),
  stashApply: (path: string, index: number) =>
    invoke<string>('stash_apply', { path, index }),
  stashPop: (path: string, index: number) =>
    invoke<string>('stash_pop', { path, index }),
  stashDrop: (path: string, index: number) =>
    invoke<string>('stash_drop', { path, index }),
  mergeBranch: (path: string, name: string) =>
    invoke<string>('merge_branch', { path, name }),
  cherryPickCommit: (path: string, commit: string) =>
    invoke<string>('cherry_pick_commit', { path, commit }),
  revertCommit: (path: string, commit: string) =>
    invoke<string>('revert_commit', { path, commit }),
  resetToCommit: (path: string, commit: string, mode: ResetMode) =>
    invoke<string>('reset_to_commit', { path, commit, mode }),
  resolveConflict: (path: string, file: string, useOurs: boolean) =>
    invoke('resolve_conflict', { path, file, useOurs }),
  getConflictFileContent: (path: string, file: string) =>
    invoke<string>('get_conflict_file_content', { path, file }),
  resolveConflictManually: (path: string, file: string, content: string) =>
    invoke('resolve_conflict_manually', { path, file, content }),
  abortOperation: (path: string) => invoke<string>('abort_operation', { path }),
  rebaseCommits: (path: string, base: string) =>
    invoke<RebaseCommit[]>('rebase_commits', { path, base }),
  rebaseExecute: (path: string, base: string, items: RebaseItem[]) =>
    invoke<string>('rebase_execute', { path, base, items }),
  rebaseContinue: (path: string) => invoke<string>('rebase_continue', { path }),
};

export function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'scss':
    case 'sass':
      return 'scss';
    case 'html':
    case 'htm':
      return 'html';
    case 'rs':
      return 'rust';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'java':
      return 'java';
    case 'c':
    case 'h':
      return 'c';
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return 'cpp';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'toml':
      return 'ini';
    case 'xml':
      return 'xml';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell';
    case 'sql':
      return 'sql';
    case 'rb':
      return 'ruby';
    case 'php':
      return 'php';
    case 'swift':
      return 'swift';
    case 'kt':
      return 'kotlin';
    case 'vue':
      return 'html';
    default:
      return 'plaintext';
  }
}
