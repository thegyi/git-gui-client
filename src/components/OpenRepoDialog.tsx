import { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpen: (path: string) => void;
}

export default function OpenRepoDialog({ open, onClose, onOpen }: Props) {
  const [path, setPath] = useState('');

  if (!open) return null;

  const browse = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === 'string') setPath(selected);
  };

  const submit = () => {
    const p = path.trim();
    if (p) onOpen(p);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Open Repository</h2>
        <p className="muted">Path to a local git repository (worktree or .git dir).</p>
        <label className="field">
          <span>Repository path</span>
          <div className="clone-dir-row">
            <input
              className="input"
              placeholder="/path/to/repository"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              autoFocus
            />
            <button className="btn" onClick={browse}>
              Browse…
            </button>
          </div>
        </label>
        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!path.trim()}>
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
