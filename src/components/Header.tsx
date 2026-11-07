import { RepoInfo } from '../api';

interface Props {
  repoInfo: RepoInfo | null;
  loading: boolean;
  remoteBusy: string | null;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onOpenSettings: () => void;
  onOpenRepo: () => void;
  onClone: () => void;
  onRefresh: () => void;
}

export default function Header({
  repoInfo,
  loading,
  remoteBusy,
  onFetch,
  onPull,
  onPush,
  onOpenSettings,
  onOpenRepo,
  onClone,
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
            {repoInfo.gitlabMatched && <span className="gitlab-badge">GitLab</span>}
            {repoInfo.remoteUrl && (
              <span className="remote-badge" title={repoInfo.remoteUrl}>
                {repoInfo.remoteUrl}
              </span>
            )}
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
                className="btn remote-action"
                onClick={onPull}
                disabled={busy}
                title="Pull (fetch + merge)"
              >
                {remoteBusy === 'pull' ? (
                  '…'
                ) : (
                  <>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M8 1.5v9m0 0 3.5-3.5M8 10.5 4.5 7M2 12.5v2h12v-2" />
                    </svg>
                    Pull
                  </>
                )}
              </button>
            )}
            <button
              className="btn remote-action"
              onClick={onPush}
              disabled={busy}
              title="Push current branch"
            >
              {remoteBusy === 'push' ? (
                '…'
              ) : (
                <>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 14.5v-9m0 0L4.5 9M8 5.5 11.5 9M2 3.5v-2h12v2" />
                  </svg>
                  Push
                </>
              )}
            </button>
            <button className="btn" onClick={onRefresh} title="Refresh">
              ⟳ Refresh
            </button>
          </>
        )}
        <button className="btn" onClick={onOpenSettings} title="Settings">
          ⚙
        </button>
        <button className="btn" onClick={onClone} title="Clone a repository">
          Clone…
        </button>
        <button className="btn primary" onClick={onOpenRepo}>
          {repoInfo ? 'Open Repo…' : 'Open Repository…'}
        </button>
      </div>
    </header>
  );
}
