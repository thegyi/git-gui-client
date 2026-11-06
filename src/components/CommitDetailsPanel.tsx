import { CommitDetails } from '../api';

interface Props {
  details: CommitDetails | null;
  onOpenFile: (hash: string, path: string) => void;
}

function statusClass(s: string): string {
  switch (s) {
    case 'A':
      return 'A';
    case 'D':
      return 'D';
    case 'R':
      return 'R';
    case 'M':
      return 'M';
    default:
      return 'U';
  }
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleString();
}

export default function CommitDetailsPanel({ details, onOpenFile }: Props) {
  if (!details) {
    return <div className="panel-empty">Select a commit to see its details.</div>;
  }

  return (
    <div className="commit-details">
      <div className="cd-header">
        <div className="cd-title-row">
          <code className="cd-hash" title={details.id}>
            {details.shortId}
          </code>
          {details.refs
            .filter((r) => r.kind !== 'head')
            .map((r) => (
              <span
                key={`${r.kind}:${r.name}`}
                className={`ref-badge ${r.kind === 'tag' ? 'tag' : r.kind === 'remote' ? 'remote' : 'branch'}`}
              >
                {r.name}
              </span>
            ))}
        </div>
        <div className="cd-meta">
          <span>
            <b>{details.authorName}</b> &lt;{details.authorEmail}&gt;
          </span>
          <span title={new Date(details.time * 1000).toLocaleString()}>
            {timeAgo(details.time)}
          </span>
          <span className="cd-stats">
            {details.stats.files} file{details.stats.files === 1 ? '' : 's'} changed ·{' '}
            <span className="adds">+{details.stats.additions}</span>{' '}
            <span className="dels">−{details.stats.deletions}</span>
          </span>
        </div>
        {details.message && <pre className="cd-message">{details.message}</pre>}
      </div>
      <div className="cd-files">
        {details.changes.map((c) => (
          <div
            key={c.path}
            className="file-row"
            onClick={() => onOpenFile(details.id, c.path)}
            title={c.path}
          >
            <span className={`status-letter ${statusClass(c.status)}`}>{c.status}</span>
            <span className="file-path">
              {c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
            </span>
            <span className="file-stats">
              {c.additions > 0 && <span className="adds">+{c.additions}</span>}
              {c.deletions > 0 && <span className="dels">−{c.deletions}</span>}
            </span>
          </div>
        ))}
        {details.changes.length === 0 && (
          <div className="panel-empty">No file changes (e.g. merge or empty commit).</div>
        )}
      </div>
    </div>
  );
}
