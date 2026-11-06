import { RepoInfo } from '../api';

interface Props {
  repoInfo: RepoInfo | null;
  loading: boolean;
  onOpenRepo: () => void;
  onRefresh: () => void;
}

export default function Header({ repoInfo, loading, onOpenRepo, onRefresh }: Props) {
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
          <button className="btn" onClick={onRefresh} title="Refresh">
            ⟳ Refresh
          </button>
        )}
        <button className="btn primary" onClick={onOpenRepo}>
          {repoInfo ? 'Open Repo…' : 'Open Repository…'}
        </button>
      </div>
    </header>
  );
}
