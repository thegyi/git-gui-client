import { useEffect, useRef, useState } from 'react';
import { api, BranchInfo } from '../api';
import { Mutate } from './Sidebar';

interface Props {
  branches: BranchInfo[];
  repoPath: string;
  isBare: boolean;
  mutate: Mutate;
}

function timeAgo(ts: number): string {
  if (!ts) return '';
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

function BranchMenu({
  branch,
  repoPath,
  mutate,
  onClose,
}: {
  branch: BranchInfo;
  repoPath: string;
  mutate: Mutate;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const item = (label: string, hint: string | undefined, fn: () => void, danger = false, disabled = false) => (
    <button
      key={label}
      className={`menu-item ${danger ? 'danger' : ''}`}
      disabled={disabled}
      onClick={() => {
        onClose();
        fn();
      }}
    >
      <span>{label}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );

  return (
    <div className="dropdown-menu" ref={ref}>
      {item(
        'Switch to this branch',
        branch.isRemote ? 'creates a local tracking branch' : undefined,
        () => void mutate(() => api.checkoutBranch(repoPath, branch.name)),
        false,
        branch.isHead,
      )}
      <div className="menu-sep" />
      {!branch.isRemote &&
        !branch.isHead &&
        item(
          'Merge into current branch',
          undefined,
          () => void mutate(() => api.mergeBranch(repoPath, branch.name)),
        )}
      {item('Copy branch name', undefined, () => void navigator.clipboard.writeText(branch.name))}
      {!branch.isRemote &&
        item(
          'Delete branch',
          branch.isHead ? 'cannot delete current branch' : undefined,
          () => {
            if (window.confirm(`Delete branch "${branch.name}"?`)) {
              void mutate(() => api.deleteBranch(repoPath, branch.name));
            }
          },
          true,
          branch.isHead,
        )}
      {branch.isRemote &&
        item(
          'Delete remote branch',
          'deletes from remote',
          () => {
            if (window.confirm(`Delete remote branch "${branch.name}"? This cannot be undone.`)) {
              void mutate(() => api.deleteRemoteBranch(repoPath, branch.name));
            }
          },
          true,
        )}
    </div>
  );
}

export default function BranchesPanel({ branches, repoPath, isBare, mutate }: Props) {
  const [name, setName] = useState('');
  const [checkout, setCheckout] = useState(true);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const create = () => {
    const n = name.trim();
    if (!n) return;
    void mutate(() => api.createBranch(repoPath, n, checkout)).then(() => setName(''));
  };

  const locals = branches.filter((b) => !b.isRemote);
  const remotes = branches.filter((b) => b.isRemote);

  const row = (b: BranchInfo) => (
    <div key={b.name} className={`branch-row ${b.isHead ? 'head' : ''}`}>
      <span className="branch-name" title={b.name}>
        {b.isRemote && <span className="tag-remote">remote</span>}
        {b.name}
        {b.upstream && <span className="upstream"> → {b.upstream}</span>}
      </span>
      <span className="branch-meta">{timeAgo(b.lastCommitTime)}</span>
      {!isBare && (
        <span className="file-actions always">
          {menuFor === b.name ? (
            <BranchMenu
              branch={b}
              repoPath={repoPath}
              mutate={mutate}
              onClose={() => setMenuFor(null)}
            />
          ) : (
            <button
              className="mini-btn"
              title="Branch actions"
              onClick={(e) => {
                e.stopPropagation();
                setMenuFor(menuFor === b.name ? null : b.name);
              }}
            >
              ⋯
            </button>
          )}
        </span>
      )}
      {b.isHead && <span className="current-tag">current</span>}
    </div>
  );

  return (
    <div className="branches-panel">
      {!isBare && (
        <div className="branch-create">
          <input
            className="input"
            placeholder="New branch name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={checkout}
              onChange={(e) => setCheckout(e.target.checked)}
            />
            checkout
          </label>
          <button className="btn" disabled={!name.trim()} onClick={create}>
            Create
          </button>
        </div>
      )}
      {locals.length === 0 && remotes.length === 0 && (
        <div className="panel-empty">No branches.</div>
      )}
      {locals.map(row)}
      {remotes.length > 0 && <div className="group-header">Remote branches</div>}
      {remotes.map(row)}
    </div>
  );
}
