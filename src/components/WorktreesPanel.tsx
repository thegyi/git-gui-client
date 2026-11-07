import { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { api, BranchInfo, WorktreeInfo } from '../api';
import { Mutate } from './Sidebar';

interface Props {
  branches: BranchInfo[];
  worktrees: WorktreeInfo[];
  repoPath: string;
  isBare: boolean;
  mutate: Mutate;
  onOpen: (path: string) => void;
}

export default function WorktreesPanel({
  branches,
  worktrees,
  repoPath,
  isBare,
  mutate,
  onOpen,
}: Props) {
  const [worktreePath, setWorktreePath] = useState('');
  const [startPoint, setStartPoint] = useState('HEAD');
  const [newBranch, setNewBranch] = useState('');

  const browse = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === 'string') setWorktreePath(selected);
  };

  const add = () => {
    const destination = worktreePath.trim();
    if (!destination) return;
    void mutate(() =>
      api.addWorktree(
        repoPath,
        destination,
        startPoint,
        newBranch.trim() || undefined,
      ),
    ).then((success) => {
      if (success) {
        setWorktreePath('');
        setNewBranch('');
      }
    });
  };

  return (
    <div className="worktrees-panel">
      <div className="group-header">Worktrees</div>
      {worktrees.map((worktree) => (
        <div className="worktree-row" key={worktree.path}>
          <div className="worktree-info">
            <span className="worktree-branch">
              {worktree.isBare ? 'Bare repository' : worktree.branch ?? 'Detached HEAD'}
              {worktree.isCurrent && <span className="current-tag">current</span>}
            </span>
            <span className="worktree-path" title={worktree.path}>{worktree.path}</span>
          </div>
          <button
            className="mini-btn"
            disabled={worktree.isCurrent}
            title={worktree.isCurrent ? 'Already open' : 'Open this worktree'}
            onClick={() => onOpen(worktree.path)}
          >
            Open
          </button>
          {!worktree.isCurrent && (
            <button
              className="mini-btn danger"
              title="Remove worktree (Git refuses if it has uncommitted changes)"
              onClick={() => {
                if (
                  window.confirm(
                    `Remove worktree at "${worktree.path}"? Git will refuse if it has uncommitted changes.`,
                  )
                ) {
                  void mutate(() => api.removeWorktree(repoPath, worktree.path));
                }
              }}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {!isBare && (
        <section className="worktree-create">
          <div className="group-header">Add worktree</div>
          <label className="field">
            Destination folder (must be empty or not exist)
            <div className="worktree-path-input">
              <input
                className="input"
                value={worktreePath}
                onChange={(e) => setWorktreePath(e.target.value)}
                placeholder="/path/to/worktree"
              />
              <button className="btn" onClick={() => void browse()}>Browse…</button>
            </div>
          </label>
          <label className="field">
            Start point
            <select
              className="input"
              value={startPoint}
              onChange={(e) => setStartPoint(e.currentTarget.value)}
            >
              <option value="HEAD">HEAD</option>
              {branches.map((branch) => (
                <option key={`${branch.isRemote ? 'remote' : 'local'}:${branch.name}`} value={branch.isRemote ? `refs/remotes/${branch.name}` : branch.name}>
                  {branch.isRemote ? `Remote: ${branch.name}` : branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            New branch name (optional)
            <input
              className="input"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder="Leave blank to check out an existing branch"
            />
          </label>
          <p className="hint">
            Leave the branch name blank to check out an existing branch that is not already in use. Using HEAD without a new branch creates a detached worktree.
          </p>
          <button className="btn primary" disabled={!worktreePath.trim()} onClick={add}>
            Add worktree
          </button>
        </section>
      )}
    </div>
  );
}
