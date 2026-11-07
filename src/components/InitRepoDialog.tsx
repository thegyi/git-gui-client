import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { api } from '../api';

interface Props {
  open: boolean;
  defaultPath: string;
  onClose: () => void;
  onCreated: (path: string) => void;
}

export default function InitRepoDialog({ open, defaultPath, onClose, onCreated }: Props) {
  const [path, setPath] = useState(defaultPath);
  const [initialCommit, setInitialCommit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPath(defaultPath);
    setInitialCommit(true);
    setError(null);
  }, [open, defaultPath]);

  if (!open) return null;

  const browse = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === 'string') setPath(selected);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.initRepo(path.trim(), initialCommit));
    } catch (cause) {
      setError(String(cause));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h2>Create Repository</h2>
        <p className="muted">Initialize a new Git repository in an empty directory.</p>
        <label className="field">
          <span>Repository directory</span>
          <div className="clone-dir-row">
            <input
              className="input"
              placeholder="/path/to/new-repository"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && path.trim() && !busy && void create()}
              autoFocus
            />
            <button className="btn" onClick={() => void browse()} disabled={busy}>Browse…</button>
          </div>
        </label>
        <label className="field checkbox-field">
          <span>
            <input
              type="checkbox"
              checked={initialCommit}
              onChange={(event) => setInitialCommit(event.currentTarget.checked)}
            />
            Create an initial commit with a README
          </span>
        </label>
        {initialCommit && (
          <p className="muted small">Requires your Git author name and email to be configured.</p>
        )}
        {error && <div className="settings-msg err">{error}</div>}
        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={() => void create()} disabled={busy || !path.trim()}>
            {busy ? 'Creating…' : 'Create & Open'}
          </button>
        </div>
      </div>
    </div>
  );
}
