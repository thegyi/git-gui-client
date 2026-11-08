import { useCallback, useEffect, useState } from 'react';
import { api, SubmoduleInfo } from '../api';
import { Mutate } from './Sidebar';

interface Props {
  repoPath: string;
  isBare: boolean;
  mutate: Mutate;
  onOpenSubmodule: (path: string) => void;
}

export default function SubmodulesPanel({
  repoPath,
  isBare,
  mutate,
  onOpenSubmodule,
}: Props) {
  const [submodules, setSubmodules] = useState<SubmoduleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSubmodules(await api.getSubmodules(repoPath));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = async (submodule: SubmoduleInfo) => {
    const success = await mutate(() => api.updateSubmodule(repoPath, submodule.path));
    if (success) await refresh();
  };

  if (isBare) return <div className="panel-empty">Bare repositories do not have a working tree.</div>;

  return (
    <div className="submodules-panel">
      <div className="submodules-header">
        <div className="group-header">Submodules</div>
        <button className="mini-btn" disabled={loading} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {loading && <div className="panel-empty">Loading submodules…</div>}
      {error && <div className="panel-empty error-text">{error}</div>}
      {!loading && !error && submodules.length === 0 && (
        <div className="panel-empty">No submodules are configured.</div>
      )}
      {!loading && !error && submodules.map((submodule) => (
        <div className="submodule-row" key={submodule.name}>
          <div className="submodule-details">
            <span className="submodule-path" title={submodule.path}>{submodule.path}</span>
            <span className="submodule-url" title={submodule.url}>{submodule.url}</span>
            <span className={`submodule-status ${submodule.status === 'clean' ? 'clean' : ''}`}>
              {submodule.status}
            </span>
            {submodule.commitId && (
              <span className="submodule-commit" title={`Recorded ${submodule.commitId}`}>
                recorded {submodule.commitId.slice(0, 7)}
                {submodule.currentCommitId &&
                  submodule.currentCommitId !== submodule.commitId &&
                  ` · checked out ${submodule.currentCommitId.slice(0, 7)}`}
              </span>
            )}
          </div>
          <button
            className="mini-btn"
            disabled={loading || !submodule.initialized}
            onClick={() => onOpenSubmodule(submodule.fullPath)}
            title="Open this submodule repository"
          >
            Open
          </button>
          <button
            className="mini-btn"
            disabled={loading}
            onClick={() => void update(submodule)}
            title="Initialize or check out the commit recorded by this repository"
          >
            {submodule.initialized ? 'Update' : 'Initialize'}
          </button>
        </div>
      ))}
    </div>
  );
}
