import { RepoInfo } from '../api';

interface Props {
  repoInfo: RepoInfo | null;
  loading: boolean;
  remoteBusy: string | null;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onOpenRepo: () => void;
  onRefresh: () => void;
}

export default function Header({
  repoInfo,
  loading,
  remoteBusy,
  onFetch,
  onPull,
  onPush,
  onOpenRepo,
  onRefresh,
}: Props) {
  const busy = remoteBusy !== null;
  return (
    <header className="header">
      <div className="header-left">
        <span className="logo">⎇ Git GUI</span>
        {repoInfo && (
          <>
            <span className="header-sep">/</span>
            <span className="repo-name" title={repoInfo.path}>
              {repoInfo.name}
            </span>
            {repoInfo.branch ? (
              <span className="branch-badge">⎇ {repoInfo.branch}</span>
            ) : repoInfo.detached ? (
              <span className="branch-badge detached">HEAD detached</span>
            ) : null}
          </>
        )}
      </div>
      <div className="header-right">
        {loading && <span className="spinner" title="Loading" />}
        {repoInfo && (
          <>
            <button
              className="btn"
              onClick={onFetch}
              disabled={busy}
              title="Fetch all remotes"
            >
              {remoteBusy === 'fetch' ? '…' : 'Fetch'}
            </button>
            {!repoInfo.isBare && (
              <button
                className="btn"
                onClick={onPull}
                disabled={busy}
                title="Pull (fetch + merge)"
              >
                {remoteBusy === 'pull' ? '…' : 'Pull'}
              </button>
            )}
            <button
              className="btn"
              onClick={onPush}
              disabled={busy}
              title="Push current branch"
            >
              {remoteBusy === 'push' ? '…' : 'Push'}
            </button>
            <button className="btn" onClick={onRefresh} title="Refresh">
              ⟳ Refresh
            </button>
          </>
        )}
        <button className="btn primary" onClick={onOpenRepo}>
          {repoInfo ? 'Open Repo…' : 'Open Repository…'}
        </button>
      </div>
    </header>
  );
}
