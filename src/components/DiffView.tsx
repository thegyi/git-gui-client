import { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { api, FileDiff, languageForPath } from '../api';
import type { DiffTarget } from '../App';

interface Props {
  repoPath: string;
  target: DiffTarget;
  dataVersion: number;
}

export default function DiffView({ repoPath, target, dataVersion }: Props) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sideBySide, setSideBySide] = useState(true);

  const workdir = target.kind === 'workdir' ? target : null;
  const commit = target.kind === 'commit' ? target : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const req = workdir
      ? api.getFileDiff(repoPath, workdir.path, workdir.staged)
      : api.getCommitFileDiff(repoPath, commit!.hash, commit!.path);
    req
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, target, dataVersion]);

  const filePath = workdir?.path ?? commit?.path ?? '';
  const label = workdir
    ? `${filePath} — ${workdir.staged ? 'staged' : 'unstaged'}`
    : `${filePath} — commit ${commit!.hash.slice(0, 7)}`;

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="diff-title" title={filePath}>
          {label}
        </span>
        <span className="spacer" />
        {diff?.truncated && <span className="warn-badge">truncated</span>}
        {diff && !diff.isBinary && (
          <button className="mini-btn" onClick={() => setSideBySide((s) => !s)}>
            {sideBySide ? '⇤ Inline' : '⇥ Split'}
          </button>
        )}
      </div>
      <div className="diff-body">
        {loading && <div className="panel-empty">Loading diff…</div>}
        {error && <div className="panel-empty error-text">{error}</div>}
        {!loading && !error && diff?.isBinary && (
          <div className="panel-empty">Binary file — diff not shown.</div>
        )}
        {!loading && !error && diff && !diff.isBinary && (
          <DiffEditor
            height="100%"
            language={languageForPath(filePath)}
            original={diff.oldContent}
            modified={diff.newContent}
            theme="vs-dark"
            options={{
              readOnly: true,
              renderSideBySide: sideBySide,
              minimap: { enabled: false },
              fontSize: 12,
              lineHeight: 18,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: 'on',
              renderOverviewRuler: false,
              hideCursorInOverviewRuler: true,
              scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
            }}
          />
        )}
      </div>
    </div>
  );
}
