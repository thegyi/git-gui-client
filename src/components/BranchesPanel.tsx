import { useEffect, useRef, useState } from 'react';
import { api, BranchComparison, BranchInfo, RemoteInfo } from '../api';
import { Mutate } from './Sidebar';

interface Props {
  branches: BranchInfo[];
  remotes: RemoteInfo[];
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

function branchRef(branch: BranchInfo): string {
  return `${branch.isRemote ? 'refs/remotes' : 'refs/heads'}/${branch.name}`;
}

function BranchComparisonSection({ branches, repoPath }: { branches: BranchInfo[]; repoPath: string }) {
  const options = branches.filter((branch) => branch.lastCommitId);
  const current = options.find((branch) => branch.isHead);
  const currentUpstream = current?.upstream
    ? options.find((branch) => branch.name === current.upstream && branch.isRemote)
    : undefined;
  const [baseSelection, setBaseSelection] = useState('');
  const [compareSelection, setCompareSelection] = useState('');
  const base =
    options.find((branch) => branchRef(branch) === baseSelection) ??
    currentUpstream ??
    options.find((branch) => !branch.isHead) ??
    current;
  const compare =
    options.find((branch) => branchRef(branch) === compareSelection) ??
    current ??
    options.find((branch) => !branch.isRemote);
  const [result, setResult] = useState<BranchComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runComparison = async () => {
    if (!base || !compare || branchRef(base) === branchRef(compare)) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await api.compareBranches(repoPath, branchRef(base), branchRef(compare)));
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const commitList = (title: string, commits: BranchComparison['aheadCommits'], count: number) => (
    <div className="branch-compare-list">
      <div className="group-header">{title} ({count})</div>
      {commits.length === 0 ? (
        <div className="panel-empty">No unique commits.</div>
      ) : (
        commits.map((commit) => (
          <div className="branch-compare-commit" key={commit.id} title={commit.authorName}>
            <code>{commit.shortId}</code>
            <span>{commit.subject || '(no subject)'}</span>
          </div>
        ))
      )}
      {count > commits.length && (
        <div className="panel-empty">Showing the newest {commits.length} commits.</div>
      )}
    </div>
  );

  return (
    <section className="branch-compare">
      <div className="group-header">Compare branches</div>
      {options.length < 2 ? (
        <div className="panel-empty">At least two branches with commits are needed.</div>
      ) : (
        <>
          <label>
            Base
            <select
              className="input"
              value={base ? branchRef(base) : ''}
              onChange={(e) => setBaseSelection(e.currentTarget.value)}
            >
              {options.map((branch) => (
                <option key={branchRef(branch)} value={branchRef(branch)}>
                  {branch.name}{branch.isRemote ? ' (remote)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Compare
            <select
              className="input"
              value={compare ? branchRef(compare) : ''}
              onChange={(e) => setCompareSelection(e.currentTarget.value)}
            >
              {options.map((branch) => (
                <option key={branchRef(branch)} value={branchRef(branch)}>
                  {branch.name}{branch.isRemote ? ' (remote)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            disabled={loading || !base || !compare || branchRef(base) === branchRef(compare)}
            onClick={() => void runComparison()}
          >
            {loading ? 'Comparing…' : 'Compare'}
          </button>
          {error && <div className="error-text">{error}</div>}
          {result && (
            <>
              <div className="branch-compare-summary">
                {result.ahead} ahead · {result.behind} behind
              </div>
              {commitList(`Only in ${compare?.name}`, result.aheadCommits, result.ahead)}
              {commitList(`Only in ${base?.name}`, result.behindCommits, result.behind)}
            </>
          )}
        </>
      )}
    </section>
  );
}

function BranchMenu({
  branch,
  repoPath,
  mutate,
  remoteBranches,
  onClose,
}: {
  branch: BranchInfo;
  repoPath: string;
  mutate: Mutate;
  remoteBranches: BranchInfo[];
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
        <label className="menu-item upstream-menu">
          <span>Upstream</span>
          <select
            className="input"
            value={branch.upstream ?? ''}
            onChange={(e) => {
              const upstream = e.currentTarget.value || undefined;
              void mutate(() => api.setUpstream(repoPath, branch.name, upstream));
            }}
          >
            <option value="">No upstream</option>
            {remoteBranches.map((remote) => (
              <option key={remote.name} value={remote.name}>
                {remote.name}
              </option>
            ))}
          </select>
        </label>}
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

export default function BranchesPanel({
  branches,
  remotes: remoteInfos,
  repoPath,
  isBare,
  mutate,
}: Props) {
  const [name, setName] = useState('');
  const [checkout, setCheckout] = useState(true);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [remoteName, setRemoteName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [editingRemote, setEditingRemote] = useState<string | null>(null);
  const [editingUrl, setEditingUrl] = useState('');

  const create = () => {
    const n = name.trim();
    if (!n) return;
    void mutate(() => api.createBranch(repoPath, n, checkout)).then((success) => {
      if (success) setName('');
    });
  };

  const locals = branches.filter((b) => !b.isRemote);
  const remoteBranches = branches.filter((b) => b.isRemote);

  const addRemote = () => {
    const n = remoteName.trim();
    const url = remoteUrl.trim();
    if (!n || !url) return;
    void mutate(() => api.addRemote(repoPath, n, url)).then((success) => {
      if (success) {
        setRemoteName('');
        setRemoteUrl('');
      }
    });
  };

  const saveRemoteUrl = (remote: RemoteInfo) => {
    const url = editingUrl.trim();
    if (!url) return;
    void mutate(() => api.setRemoteUrl(repoPath, remote.name, url)).then((success) => {
      if (success) setEditingRemote(null);
    });
  };

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
              remoteBranches={remoteBranches}
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
      <section className="remote-manager">
        <div className="group-header">Remotes</div>
        {remoteInfos.length === 0 && <div className="panel-empty">No remotes configured.</div>}
        {remoteInfos.map((remote) => (
            <div className="remote-manager-row" key={remote.name}>
              {editingRemote === remote.name ? (
                <>
                  <input
                    className="input"
                    aria-label={`URL for remote ${remote.name}`}
                    value={editingUrl}
                    onChange={(e) => setEditingUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveRemoteUrl(remote)}
                  />
                  <button
                    className="mini-btn"
                    disabled={!editingUrl.trim()}
                    onClick={() => saveRemoteUrl(remote)}
                  >
                    Save
                  </button>
                  <button className="mini-btn" onClick={() => setEditingRemote(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="remote-manager-name">{remote.name}</span>
                  <span className="remote-manager-url" title={remote.url}>{remote.url}</span>
                  <button
                    className="mini-btn"
                    title="Edit remote URL"
                    onClick={() => {
                      setEditingRemote(remote.name);
                      setEditingUrl(remote.url);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="mini-btn danger"
                    title="Remove remote"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove remote "${remote.name}" and its local tracking branches?`,
                        )
                      ) {
                        void mutate(() => api.removeRemote(repoPath, remote.name));
                      }
                    }}
                  >
                    ×
                  </button>
                </>
              )}
            </div>
        ))}
        <div className="remote-add-row">
          <input
            className="input"
            placeholder="Remote name"
            value={remoteName}
            onChange={(e) => setRemoteName(e.target.value)}
          />
          <input
            className="input"
            placeholder="Remote URL"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRemote()}
          />
          <button
            className="mini-btn"
            disabled={!remoteName.trim() || !remoteUrl.trim()}
            onClick={addRemote}
          >
            Add
          </button>
        </div>
      </section>
      <BranchComparisonSection branches={branches} repoPath={repoPath} />
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
      {locals.length === 0 && remoteBranches.length === 0 && (
        <div className="panel-empty">No branches.</div>
      )}
      {locals.map(row)}
      {remoteBranches.length > 0 && <div className="group-header">Remote branches</div>}
      {remoteBranches.map(row)}
    </div>
  );
}
