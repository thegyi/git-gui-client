import { useEffect, useState } from 'react';
import { api, BlameLine, FileHistoryCommit } from '../api';

interface Props {
  repoPath: string;
  filePath: string;
  onOpenCommit: (hash: string, path: string) => void;
}

function timestamp(time: number): string {
  return time ? new Date(time * 1000).toLocaleString() : 'Uncommitted';
}

export default function FileHistoryPanel({ repoPath, filePath, onOpenCommit }: Props) {
  const [mode, setMode] = useState<'history' | 'blame'>('history');
  const [history, setHistory] = useState<FileHistoryCommit[]>([]);
  const [blame, setBlame] = useState<BlameLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        if (mode === 'history') {
          const result = await api.getFileHistory(repoPath, filePath);
          if (!cancelled) setHistory(result);
        } else {
          const result = await api.getFileBlame(repoPath, filePath);
          if (!cancelled) setBlame(result);
        }
      } catch (cause) {
        if (!cancelled) setError(String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [repoPath, filePath, mode]);

  return (
    <div className="file-history">
      <div className="file-history-toolbar">
        <span className="file-history-path" title={filePath}>{filePath}</span>
        <span className="spacer" />
        <button
          className={`mini-btn ${mode === 'history' ? 'active' : ''}`}
          onClick={() => setMode('history')}
        >
          History
        </button>
        <button
          className={`mini-btn ${mode === 'blame' ? 'active' : ''}`}
          onClick={() => setMode('blame')}
        >
          Blame
        </button>
      </div>
      <div className="file-history-body">
        {loading && <div className="panel-empty">Loading {mode}…</div>}
        {error && <div className="panel-empty error-text">{error}</div>}
        {!loading && !error && mode === 'history' && history.length === 0 && (
          <div className="panel-empty">No committed history found for this file.</div>
        )}
        {!loading && !error && mode === 'history' && history.map((commit) => (
          <button
            className="file-history-commit"
            key={commit.id}
            onClick={() => onOpenCommit(commit.id, filePath)}
            title={`${commit.author} · ${timestamp(commit.time)}`}
          >
            <code>{commit.shortId}</code>
            <span className="file-history-subject">{commit.subject || '(no subject)'}</span>
            <span className="file-history-author">{commit.author}</span>
            <time>{timestamp(commit.time)}</time>
          </button>
        ))}
        {!loading && !error && mode === 'blame' && blame.length === 0 && (
          <div className="panel-empty">No blame information available.</div>
        )}
        {!loading && !error && mode === 'blame' && blame.map((line) => (
          <button
            className="file-blame-line"
            key={`${line.lineNumber}:${line.commitId}`}
            onClick={() => line.time && onOpenCommit(line.commitId, filePath)}
            disabled={!line.time}
            title={line.summary || (line.time ? '' : 'Uncommitted line')}
          >
            <code className="file-blame-number">{line.lineNumber}</code>
            <code className="file-blame-commit">{line.shortId}</code>
            <span className="file-blame-author">{line.author || 'Uncommitted'}</span>
            <code className="file-blame-content">{line.content || ' '}</code>
          </button>
        ))}
      </div>
    </div>
  );
}
