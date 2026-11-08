import { useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
import { api, FileStatus, StashInfo } from '../api';
import { Mutate } from './Sidebar';

type StashScope = 'all' | 'staged' | 'selected';

interface Props {
  stashes: StashInfo[];
  status: FileStatus[];
  repoPath: string;
  isBare: boolean;
  mutate: Mutate;
}

function timeAgo(ts: number): string {
  if (!ts) return '';
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export default function StashesPanel({ stashes, status, repoPath, isBare, mutate }: Props) {
  const [message, setMessage] = useState('');
  const [scope, setScope] = useState<StashScope>('all');
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);

  if (isBare) return <div className="panel-empty">Bare repository — no working tree.</div>;

  const changedFiles = status.filter((file) => file.staged || file.unstaged || file.untracked);
  const stagedCount = changedFiles.filter((file) => file.staged).length;
  const stagedOnlyBlocked = changedFiles.some((file) => file.staged && file.unstaged);
  const selectedFileEntries = changedFiles.filter((file) => selectedPaths.includes(file.path));
  const selectedHasChanges = selectedFileEntries.some(
    (file) => file.staged || file.unstaged || (includeUntracked && file.untracked),
  );
  const canStash = scope === 'all'
    ? changedFiles.some((file) => file.staged || file.unstaged || (includeUntracked && file.untracked))
    : scope === 'staged'
      ? stagedCount > 0
      : selectedHasChanges;

  const stash = () => {
    const m = message.trim();
    const files = scope === 'selected'
      ? Array.from(new Set(selectedFileEntries.flatMap((file) =>
          file.oldPath ? [file.path, file.oldPath] : [file.path],
        )))
      : [];
    void mutate(() => api.stashPush(repoPath, m || undefined, {
      stagedOnly: scope === 'staged',
      includeUntracked: scope !== 'staged' && includeUntracked,
      files,
    })).then((success) => {
      if (success) {
        setMessage('');
        setSelectedPaths([]);
      }
    });
  };

  return (
    <div className="stashes-panel">
      <div className="stash-create">
        <input
          className="input"
          placeholder="Stash message (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && stash()}
        />
      </div>
      <div className="stash-options">
        <label>
          <input
            type="radio"
            name={`stash-scope-${repoPath}`}
            checked={scope === 'all'}
            onChange={() => setScope('all')}
          />
          All changes
        </label>
        <label title={
          stagedOnlyBlocked
            ? 'Git cannot stash staged changes from files that also have unstaged edits.'
            : `${stagedCount} staged file${stagedCount === 1 ? '' : 's'}`
        }>
          <input
            type="radio"
            name={`stash-scope-${repoPath}`}
            checked={scope === 'staged'}
            disabled={stagedCount === 0 || stagedOnlyBlocked}
            onChange={() => setScope('staged')}
          />
          Staged only
        </label>
        {stagedOnlyBlocked && (
          <span className="muted small stash-hint">
            Stage or stash the unstaged edits in the same file first to stash staged changes.
          </span>
        )}
        <label>
          <input
            type="radio"
            name={`stash-scope-${repoPath}`}
            checked={scope === 'selected'}
            onChange={() => {
              setSelectedPaths(changedFiles.map((file) => file.path));
              setScope('selected');
            }}
          />
          Selected files
        </label>
        {scope !== 'staged' && (
          <label className="stash-untracked">
            <input
              type="checkbox"
              checked={includeUntracked}
              onChange={(event) => setIncludeUntracked(event.currentTarget.checked)}
            />
            Include untracked
          </label>
        )}
        {scope === 'selected' && (
          <div className="stash-file-list">
            {changedFiles.length === 0 ? (
              <span className="muted small">No changed files.</span>
            ) : changedFiles.map((file) => (
              <label key={file.path} title={file.path}>
                <input
                  type="checkbox"
                  checked={selectedPaths.includes(file.path)}
                  disabled={file.untracked && !includeUntracked}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelectedPaths((current) => checked
                      ? [...current, file.path]
                      : current.filter((path) => path !== file.path));
                  }}
                />
                <span className={`status-letter ${file.untracked ? '?' : file.staged ? file.indexStatus : file.workdirStatus}`}>
                  {file.untracked ? '?' : file.staged ? file.indexStatus : file.workdirStatus}
                </span>
                <span className="stash-file-name">{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
              </label>
            ))}
          </div>
        )}
        <button className="btn" onClick={stash} disabled={!canStash}>
          Stash
        </button>
      </div>
      {stashes.length === 0 ? (
        <div className="panel-empty">No stashes.</div>
      ) : (
        stashes.map((s) => (
          <div key={s.index} className="stash-row">
            <div className="stash-info" title={s.message}>
              <span className="stash-ref">stash@{'{'}{s.index}{'}'}</span>
              <span className="stash-msg">{s.message}</span>
              <span className="branch-meta">{timeAgo(s.time)}</span>
            </div>
            <span className="file-actions always">
              <button
                className="mini-btn"
                title="Apply stash (keep it)"
                onClick={() => void mutate(() => api.stashApply(repoPath, s.index))}
              >
                Apply
              </button>
              <button
                className="mini-btn"
                title="Apply stash and drop it"
                onClick={() => void mutate(() => api.stashPop(repoPath, s.index))}
              >
                Pop
              </button>
              <button
                className="mini-btn danger"
                title="Drop stash"
                onClick={async () => {
                  const message = `Drop stash@{${s.index}}?`;
                  const confirmed = isTauri()
                    ? await confirmDialog(message, {
                        title: 'Drop stash',
                        kind: 'warning',
                        okLabel: 'Drop',
                        cancelLabel: 'Cancel',
                      })
                    : window.confirm(message);
                  if (!confirmed) return;
                  void mutate(() => api.stashDrop(repoPath, s.index));
                }}
              >
                ×
              </button>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
