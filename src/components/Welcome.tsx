import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

interface Props {
  onOpen: (path: string) => void;
  onCreate: () => void;
}

export default function Welcome({ onOpen, onCreate }: Props) {
  const [path, setPath] = useState('');

  const browse = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') setPath(selected);
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>⎇ Git GUI Client</h1>
        <p className="muted">Open a local Git repository to get started.</p>
        <div className="welcome-row">
          <input
            className="input"
            placeholder="/path/to/repository"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && path.trim() && onOpen(path.trim())}
          />
          <button className="btn" onClick={browse}>
            Browse…
          </button>
          <button
            className="btn primary"
            disabled={!path.trim()}
            onClick={() => onOpen(path.trim())}
          >
            Open
          </button>
        </div>
        <button className="btn welcome-create" onClick={onCreate}>
          Create a new repository
        </button>
      </div>
    </div>
  );
}
