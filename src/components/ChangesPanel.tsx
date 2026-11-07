import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { api, FileStatus, languageForPath } from '../api';
import { Mutate } from './Sidebar';

interface Props {
  status: FileStatus[];
  repoPath: string;
  isBare: boolean;
  repoState: string;
  mutate: Mutate;
  onResolveConflictManually: (
    repoPath: string,
    file: string,
    content: string,
  ) => Promise<boolean>;
  onSelectFile: (path: string, staged: boolean) => void;
}

function FileRow({
  f,
  section,
  repoPath,
  mutate,
  onEditConflict,
  onSelectFile,
}: {
  f: FileStatus;
  section: 'staged' | 'changes' | 'untracked';
  repoPath: string;
  mutate: Mutate;
  onEditConflict: (file: string) => void;
  onSelectFile: (path: string, staged: boolean) => void;
}) {
  const staged = section === 'staged';
  const letter = staged ? f.indexStatus : f.untracked ? '?' : f.workdirStatus;
  const paths = f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;

  const act = (fn: () => Promise<unknown>) => (e: React.MouseEvent) => {
    e.stopPropagation();
    void mutate(fn);
  };

  return (
    <div
      className={`file-row ${f.conflicted ? 'conflicted' : ''}`}
      onClick={() => onSelectFile(f.path, staged)}
      title={f.path}
    >
      <span className={`status-letter ${letter}`}>{letter}</span>
      <span className="file-path">{paths}</span>
      <span className="file-actions">
        {f.conflicted ? (
          <>
            <button
              className="mini-btn"
              title="Resolve using our side"
              onClick={act(() => api.resolveConflict(repoPath, f.path, true))}
            >
              ours
            </button>
            <button
              className="mini-btn"
              title="Resolve using their side"
              onClick={act(() => api.resolveConflict(repoPath, f.path, false))}
            >
              theirs
            </button>
            <button
              className="mini-btn"
              title="Edit the conflicted file and mark it resolved"
              onClick={(e) => {
                e.stopPropagation();
                onEditConflict(f.path);
              }}
            >
              edit
            </button>
          </>
        ) : staged ? (
          <button
            className="mini-btn"
            title="Unstage"
            onClick={act(() =>
              api.unstageFiles(repoPath, f.oldPath ? [f.path, f.oldPath] : [f.path]),
            )}
          >
            −
          </button>
        ) : (
          <button
            className="mini-btn"
            title="Stage"
            onClick={act(() =>
              api.stageFiles(repoPath, f.oldPath ? [f.path, f.oldPath] : [f.path]),
            )}
          >
            +
          </button>
        )}
      </span>
    </div>
  );
}

function Group({
  title,
  files,
  section,
  repoPath,
  mutate,
  onEditConflict,
  onSelectFile,
  action,
}: {
  title: string;
  files: FileStatus[];
  section: 'staged' | 'changes' | 'untracked';
  repoPath: string;
  mutate: Mutate;
  onEditConflict: (file: string) => void;
  onSelectFile: (path: string, staged: boolean) => void;
  action?: { label: string; fn: () => Promise<unknown> };
}) {
  if (files.length === 0) return null;
  return (
    <div className="change-group">
      <div className="group-header">
        <span>
          {title} <span className="count">{files.length}</span>
        </span>
        {action && (
          <button className="mini-btn" onClick={() => void mutate(action.fn)}>
            {action.label}
          </button>
        )}
      </div>
      {files.map((f) => (
        <FileRow
          key={`${section}:${f.path}`}
          f={f}
          section={section}
          repoPath={repoPath}
          mutate={mutate}
          onEditConflict={onEditConflict}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}

export default function ChangesPanel({
  status,
  repoPath,
  isBare,
  repoState,
  mutate,
  onResolveConflictManually,
  onSelectFile,
}: Props) {
  const conflicted = status.filter((f) => f.conflicted);
  const staged = status.filter((f) => f.staged && !f.conflicted);
  const changes = status.filter((f) => f.unstaged && !f.untracked && !f.conflicted);
  const untracked = status.filter((f) => f.untracked && !f.conflicted);
  const opInProgress = !['clean', 'other'].includes(repoState);
  const [manualFile, setManualFile] = useState<string | null>(null);
  const [manualContent, setManualContent] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const openManualEditor = async (file: string) => {
    setManualFile(file);
    setManualContent('');
    setManualLoading(true);
    setManualError(null);
    try {
      setManualContent(await api.getConflictFileContent(repoPath, file));
    } catch (e) {
      setManualError(String(e));
    } finally {
      setManualLoading(false);
    }
  };

  const saveManualResolution = async () => {
    if (!manualFile || manualLoading || manualSaving) return;
    setManualSaving(true);
    setManualError(null);
    try {
      const saved = await onResolveConflictManually(repoPath, manualFile, manualContent);
      if (saved) setManualFile(null);
      else setManualError('Could not save the resolution. Check the app error message and try again.');
    } catch (e) {
      setManualError(String(e));
    } finally {
      setManualSaving(false);
    }
  };

  if (isBare) return <div className="panel-empty">Bare repository — no working tree.</div>;

  return (
    <div className="changes-panel">
      {opInProgress && (
        <div className="op-banner">
          <span>
            {repoState === 'merge' && 'Merge in progress'}
            {repoState === 'rebase' && 'Rebase in progress'}
            {repoState === 'revert' && 'Revert in progress'}
            {repoState === 'cherry-pick' && 'Cherry-pick in progress'}
            {repoState === 'bisect' && 'Bisect in progress'}
            {conflicted.length > 0 && ` — ${conflicted.length} conflicted file${conflicted.length === 1 ? '' : 's'}`}
          </span>
          <span className="op-actions">
            {repoState === 'rebase' && (
              <button
                className="mini-btn"
                onClick={() => void mutate(() => api.rebaseContinue(repoPath))}
              >
                Continue
              </button>
            )}
            <button
              className="mini-btn danger"
              onClick={() => {
                if (window.confirm(`Abort the ${repoState}?`)) {
                  void mutate(() => api.abortOperation(repoPath));
                }
              }}
            >
              Abort
            </button>
          </span>
        </div>
      )}
      {manualFile && (
        <div className="modal-overlay" onClick={() => !manualSaving && setManualFile(null)}>
          <div
            className="modal-card conflict-editor-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Resolve conflict</h2>
            <p className="muted">
              Edit <code>{manualFile}</code> to the final content. Saving writes the file and stages
              it as resolved.
            </p>
            {manualError && <div className="settings-msg err">{manualError}</div>}
            <div className="conflict-editor">
              {manualLoading ? (
                <div className="panel-empty">Loading conflict file…</div>
              ) : (
                <Editor
                  height="100%"
                  language={languageForPath(manualFile)}
                  value={manualContent}
                  onChange={(value) => setManualContent(value ?? '')}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: 'on',
                  }}
                />
              )}
            </div>
            <div className="modal-actions">
              <span className="spacer" />
              <button
                className="btn"
                disabled={manualSaving}
                onClick={() => setManualFile(null)}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={manualLoading || manualSaving || Boolean(manualError)}
                onClick={() => void saveManualResolution()}
              >
                {manualSaving ? 'Saving…' : 'Save & mark resolved'}
              </button>
            </div>
          </div>
        </div>
      )}
      {status.length === 0 && !opInProgress && (
        <div className="panel-empty">Working tree clean.</div>
      )}
      <Group
        title="Conflicts"
        files={conflicted}
        section="changes"
        repoPath={repoPath}
        mutate={mutate}
        onEditConflict={openManualEditor}
        onSelectFile={onSelectFile}
      />
      <Group
        title="Staged Changes"
        files={staged}
        section="staged"
        repoPath={repoPath}
        mutate={mutate}
        onEditConflict={openManualEditor}
        onSelectFile={onSelectFile}
        action={{ label: 'Unstage all', fn: () => api.unstageAll(repoPath) }}
      />
      <Group
        title="Changes"
        files={changes}
        section="changes"
        repoPath={repoPath}
        mutate={mutate}
        onEditConflict={openManualEditor}
        onSelectFile={onSelectFile}
      />
      <Group
        title="Untracked Files"
        files={untracked}
        section="untracked"
        repoPath={repoPath}
        mutate={mutate}
        onEditConflict={openManualEditor}
        onSelectFile={onSelectFile}
        action={{ label: 'Stage all', fn: () => api.stageAll(repoPath) }}
      />
      {(changes.length > 0 || untracked.length > 0) && (
        <button
          className="btn block"
          onClick={() => void mutate(() => api.stageAll(repoPath))}
        >
          Stage all
        </button>
      )}
    </div>
  );
}
