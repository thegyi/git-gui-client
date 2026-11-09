interface Props {
  repos: string[];
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}

function repoName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export default function RecentRepos({ repos, onOpen, onRemove }: Props) {
  if (repos.length === 0) return null;
  return (
    <div className="recent-repos">
      <div className="group-header">Recent repositories</div>
      <div className="recent-repos-list">
        {repos.map((p) => (
          <div className="recent-repos-row" key={p}>
            <button
              className="recent-repos-open"
              onClick={() => onOpen(p)}
              title={p}
            >
              <span className="recent-repos-name">{repoName(p)}</span>
              <span className="recent-repos-path muted">{p}</span>
            </button>
            <button
              className="mini-btn"
              title="Remove from recent list"
              onClick={() => onRemove(p)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
