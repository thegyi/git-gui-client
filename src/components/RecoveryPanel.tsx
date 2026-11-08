import { api, ReflogEntry } from '../api';
import { Mutate } from './Sidebar';

interface Props {
  entries: ReflogEntry[];
  repoPath: string;
  mutate: Mutate;
}

function recover(entry: ReflogEntry, repoPath: string, mutate: Mutate) {
  const branch = window.prompt(
    `Create a local branch at ${entry.shortId} (${entry.action}). Enter a branch name:`,
    `recovered-${entry.shortId}`,
  );
  if (!branch?.trim()) return;
  void mutate(() => api.recoverBranchAtCommit(repoPath, branch.trim(), entry.commitId));
}

export default function RecoveryPanel({ entries, repoPath, mutate }: Props) {
  return (
    <div className="recovery-panel">
      <div className="group-header">Recent HEAD history</div>
      <p className="hint">
        Recovery creates a new branch at the selected commit. It does not move or overwrite your current branch.
      </p>
      {entries.length === 0 ? (
        <div className="panel-empty">No reflog entries found.</div>
      ) : (
        entries.map((entry) => (
          <div className="reflog-row" key={`${entry.selector}:${entry.commitId}:${entry.time}`}>
            <span className="reflog-action" title={entry.action}>{entry.action}</span>
            <button
              className="mini-btn"
              title={`Create a new branch at ${entry.commitId}`}
              onClick={() => recover(entry, repoPath, mutate)}
            >
              Recover branch
            </button>
            <span className="reflog-meta">
              <code>{entry.shortId}</code>
              <span title={entry.selector}>{entry.selector}</span>
              <time dateTime={new Date(entry.time * 1000).toISOString()}>
                {new Date(entry.time * 1000).toLocaleString()}
              </time>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
