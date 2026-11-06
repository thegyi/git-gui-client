import { invoke } from '@tauri-apps/api/core';

export interface RepoInfo {
  path: string;
  name: string;
  isBare: boolean;
  branch: string | null;
  detached: boolean;
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
  getBranches: (path: string) => invoke<BranchInfo[]>('get_branches', { path }),
  getTags: (path: string) => invoke<TagInfo[]>('get_tags', { path }),
  getFileDiff: (path: string, filePath: string, staged: boolean) =>
    invoke<FileDiff>('get_file_diff', { path, filePath, staged }),
  getCommitFileDiff: (path: string, hash: string, filePath: string) =>
    invoke<FileDiff>('get_commit_file_diff', { path, hash, filePath }),
  getCommitDetails: (path: string, hash: string) =>
    invoke<CommitDetails>('get_commit_details', { path, hash }),
  stageFiles: (path: string, files: string[]) => invoke('stage_files', { path, files }),
  unstageFiles: (path: string, files: string[]) => invoke('unstage_files', { path, files }),
  stageAll: (path: string) => invoke('stage_all', { path }),
  unstageAll: (path: string) => invoke('unstage_all', { path }),
  commit: (path: string, message: string, amend: boolean) =>
    invoke<string>('commit', { path, message, amend }),
  checkoutBranch: (path: string, name: string) => invoke('checkout_branch', { path, name }),
  createBranch: (path: string, name: string, checkout: boolean) =>
    invoke('create_branch', { path, name, checkout }),
  deleteBranch: (path: string, name: string) => invoke('delete_branch', { path, name }),
  createTag: (path: string, name: string, message?: string) =>
    invoke('create_tag', { path, name, message: message ?? null }),
  deleteTag: (path: string, name: string) => invoke('delete_tag', { path, name }),
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
