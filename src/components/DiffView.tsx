import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { DiffEditor } from '@monaco-editor/react';
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
import type { editor as MonacoEditor } from 'monaco-editor';
import { api, FileDiff, FileHunk, languageForPath } from '../api';
import type { DiffTarget } from '../App';
import type { Mutate } from './Sidebar';

interface Props {
  repoPath: string;
  target: DiffTarget;
  dataVersion: number;
  mutate: Mutate;
  onOpenFileHistory: (path: string) => void;
}

export default function DiffView({ repoPath, target, dataVersion, mutate, onOpenFileHistory }: Props) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [hunks, setHunks] = useState<FileHunk[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hunkError, setHunkError] = useState<string | null>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const diffEditorRef = useRef<MonacoEditor.IDiffEditor | null>(null);

  const workdir = target.kind === 'workdir' ? target : null;
  const commit = target.kind === 'commit' ? target : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHunks(null);
    setHunkError(null);
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
    if (workdir) {
      api
        .getFileHunks(repoPath, workdir.path, workdir.staged)
        .then((items) => {
          if (!cancelled) setHunks(items);
        })
        .catch((e) => {
          if (!cancelled) setHunkError(String(e));
        });
    } else {
      setHunks([]);
    }
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
        {(!workdir || !workdir.untracked) && (
          <button className="mini-btn" onClick={() => onOpenFileHistory(filePath)}>
            History / blame
          </button>
        )}
        {diff?.truncated && <span className="warn-badge">truncated</span>}
        {diff && !diff.isBinary && (
          <>
            <button
              className="mini-btn"
              title="Previous change"
              aria-label="Previous change"
              onClick={() => diffEditorRef.current?.goToDiff('previous')}
            >
              ↑
            </button>
            <button
              className="mini-btn"
              title="Next change"
              aria-label="Next change"
              onClick={() => diffEditorRef.current?.goToDiff('next')}
            >
              ↓
            </button>
            <button className="mini-btn" onClick={() => setSideBySide((s) => !s)}>
              {sideBySide ? '⇤ Inline' : '⇥ Split'}
            </button>
          </>
        )}
      </div>
      <div className="diff-body">
        {loading && <div className="panel-empty">Loading diff…</div>}
        {error && <div className="panel-empty error-text">{error}</div>}
        {hunkError && <div className="panel-empty error-text">{hunkError}</div>}
        {!loading && !error && diff?.isBinary && (
          <div className="panel-empty">Binary file — diff not shown.</div>
        )}
        {workdir && !loading && !error && hunks && hunks.length > 0 && (
          <div className="hunk-list" aria-label="Diff hunks">
            {hunks.map((hunk, index) => (
              <div className="hunk-row" key={`${hunk.header}:${index}`}>
                <code title={hunk.header}>{hunk.header}</code>
                <span className="hunk-count">
                  <span className="hunk-added">+{hunk.additions}</span>
                  {' / '}
                  <span className="hunk-removed">−{hunk.deletions}</span>
                </span>
                <button
                  className="mini-btn"
                  title={`${workdir.staged ? 'Unstage' : 'Stage'} this hunk`}
                  onClick={() =>
                    void mutate(() =>
                      api.applyFileHunk(repoPath, workdir.path, workdir.staged, hunk.patch),
                    )
                  }
                >
                  {workdir.staged ? 'Unstage hunk' : 'Stage hunk'}
                </button>
                {!workdir.staged && !workdir.untracked && (
                  <button
                    className="mini-btn danger"
                    title="Discard this unstaged hunk"
                    onClick={async () => {
                      const message = 'Discard this hunk? This cannot be undone.';
                      const confirmed = isTauri()
                        ? await confirmDialog(message, {
                            title: 'Discard hunk',
                            kind: 'warning',
                            okLabel: 'Discard',
                            cancelLabel: 'Cancel',
                          })
                        : window.confirm(message);
                      if (!confirmed) return;
                      void mutate(() =>
                        api.discardWorktreeHunk(repoPath, workdir.path, hunk.patch),
                      );
                    }}
                  >
                    Discard
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {!loading && !error && diff && !diff.isBinary && (
          <div className="diff-editor">
            <DiffEditor
              // renderSideBySide is only read at editor creation, so remount
              // the editor when toggling split/inline.
              key={sideBySide ? 'split' : 'inline'}
              onMount={(editor) => {
                diffEditorRef.current = editor;
              }}
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
          </div>
        )}
      </div>
    </div>
  );
}
