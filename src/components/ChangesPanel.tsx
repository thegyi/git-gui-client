import { useState } from 'react';
import { api, FileStatus } from '../api';
import { Mutate } from './Sidebar';

interface Props {
  status: FileStatus[];
  repoPath: string;
  isBare: boolean;
  mutate: Mutate;
  onSelectFile: (path: string, staged: boolean) => void;
}

function FileRow({
  f,
  section,
  repoPath,
  mutate,
  onSelectFile,
}: {
  f: FileStatus;
  section: 'staged' | 'changes' | 'untracked';
  repoPath: string;
  mutate: Mutate;
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
        {staged ? (
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
  onSelectFile,
  action,
}: {
  title: string;
  files: FileStatus[];
  section: 'staged' | 'changes' | 'untracked';
  repoPath: string;
  mutate: Mutate;
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
  mutate,
  onSelectFile,
}: Props) {
  const staged = status.filter((f) => f.staged);
  const changes = status.filter((f) => f.unstaged && !f.untracked);
  const untracked = status.filter((f) => f.untracked);

  if (isBare) return <div className="panel-empty">Bare repository — no working tree.</div>;
  if (status.length === 0)
    return <div className="panel-empty">Working tree clean.</div>;

  return (
    <div className="changes-panel">
      <Group
        title="Staged Changes"
        files={staged}
        section="staged"
        repoPath={repoPath}
        mutate={mutate}
        onSelectFile={onSelectFile}
        action={{ label: 'Unstage all', fn: () => api.unstageAll(repoPath) }}
      />
      <Group
        title="Changes"
        files={changes}
        section="changes"
        repoPath={repoPath}
        mutate={mutate}
        onSelectFile={onSelectFile}
      />
      <Group
        title="Untracked Files"
        files={untracked}
        section="untracked"
        repoPath={repoPath}
        mutate={mutate}
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
