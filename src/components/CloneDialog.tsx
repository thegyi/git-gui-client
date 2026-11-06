import { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { api } from '../api';

interface Props {
  open: boolean;
  defaultParent: string;
  onClose: () => void;
  onCloned: (path: string) => void;
}

export default function CloneDialog({ open, defaultParent, onClose, onCloned }: Props) {
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState(defaultParent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const browse = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === 'string') setParent(selected);
  };

  const clone = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await api.cloneRepo(url.trim(), parent.trim() || '/');
      onCloned(path);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Clone Repository</h2>
        <p className="muted">
          Clone a repository from any git URL (HTTPS or SSH) into a local
          directory, then open it.
        </p>

        <label className="field">
          <span>Repository URL</span>
          <input
            className="input"
            placeholder="https://gitlab.example.com/group/project.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && url.trim() && !busy && void clone()}
          />
        </label>
        <label className="field">
          <span>Parent directory</span>
          <div className="clone-dir-row">
            <input
              className="input"
              placeholder="/path/to/parent"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
            />
            <button className="btn" onClick={browse}>
              Browse…
            </button>
          </div>
        </label>
        <p className="muted small">
          The repo is cloned into <code>&lt;parent&gt;/&lt;repo-name&gt;</code>.
        </p>

        {error && <div className="settings-msg err">{error}</div>}

        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={clone}
            disabled={busy || !url.trim() || !parent.trim()}
          >
            {busy ? 'Cloning…' : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  );
}
