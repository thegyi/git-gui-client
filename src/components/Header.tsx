import { RemoteInfo, RepoInfo } from '../api';

interface RemoteOptions {
  pruneOnFetch: boolean;
  forceWithLease: boolean;
}

interface Props {
  repoInfo: RepoInfo | null;
  remotes: RemoteInfo[];
  selectedRemote: string;
  onRemoteChange: (remote: string) => void;
  loading: boolean;
  remoteBusy: string | null;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onPushTags: () => void;
  remoteOptions: RemoteOptions;
  onRemoteOptionChange: (option: keyof RemoteOptions, enabled: boolean) => void;
  onOpenSettings: () => void;
  onOpenRepo: () => void;
  onClone: () => void;
  onRefresh: () => void;
}

export default function Header({
  repoInfo,
  remotes,
  selectedRemote,
  onRemoteChange,
  loading,
  remoteBusy,
  onFetch,
  onPull,
  onPush,
  onPushTags,
  remoteOptions,
  onRemoteOptionChange,
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
            {remotes.length > 0 && (
              <label className="remote-select" title="Remote used for fetch and push">
                <span>Remote</span>
                <select
                  className="input"
                  value={selectedRemote}
                  onChange={(e) => onRemoteChange(e.target.value)}
                  disabled={busy}
                >
                  {remotes.map((remote) => (
                    <option key={remote.name} value={remote.name}>
                      {remote.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <details className="remote-options">
              <summary>Options</summary>
              <div className="remote-options-menu">
                <label title="Remove tracking refs that no longer exist on the remote after fetching">
                  <input
                    type="checkbox"
                    checked={remoteOptions.pruneOnFetch}
                    disabled={busy}
                    onChange={(e) => onRemoteOptionChange('pruneOnFetch', e.currentTarget.checked)}
                  />
                  Prune stale branches on fetch
                </label>
                <label title="Push with --force-with-lease; refuse if the remote branch changed since your last fetch">
                  <input
                    type="checkbox"
                    checked={remoteOptions.forceWithLease}
                    disabled={busy}
                    onChange={(e) => onRemoteOptionChange('forceWithLease', e.currentTarget.checked)}
                  />
                  Use force-with-lease on push
                </label>
              </div>
            </details>
            <button
              className="btn"
              onClick={onFetch}
              disabled={busy}
              title={`${selectedRemote ? `Fetch ${selectedRemote}` : 'Fetch all remotes'}${remoteOptions.pruneOnFetch ? ' and prune stale tracking branches' : ''}`}
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
              onClick={() => {
                if (
                  remoteOptions.forceWithLease &&
                  !window.confirm(
                    `Push to ${selectedRemote} using --force-with-lease? This can rewrite remote history, but will refuse if the remote branch changed since your last fetch.`,
                  )
                ) {
                  return;
                }
                onPush();
              }}
              disabled={busy || !selectedRemote}
              title={selectedRemote
                ? `Push current branch to ${selectedRemote}${remoteOptions.forceWithLease ? ' using force-with-lease' : ''}`
                : 'Add a remote to push'}
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
            <button
              className="btn"
              onClick={() => {
                if (
                  window.confirm(
                    `Push all local tags to ${selectedRemote}? Tags already present on the remote will not be overwritten.`,
                  )
                ) {
                  onPushTags();
                }
              }}
              disabled={busy || !selectedRemote}
              title={selectedRemote ? `Push all tags to ${selectedRemote}` : 'Add a remote to push tags'}
            >
              {remoteBusy === 'push-tags' ? '…' : 'Push tags'}
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
