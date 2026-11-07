import { useState } from 'react';
import { api, StashInfo } from '../api';
import { Mutate } from './Sidebar';

interface Props {
  stashes: StashInfo[];
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

export default function StashesPanel({ stashes, repoPath, isBare, mutate }: Props) {
  const [message, setMessage] = useState('');

  if (isBare) return <div className="panel-empty">Bare repository — no working tree.</div>;

  const stash = () => {
    const m = message.trim();
    void mutate(() => api.stashPush(repoPath, m || undefined)).then((success) => {
      if (success) setMessage('');
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
        <button className="btn" onClick={stash} title="Stash all changes (incl. untracked)">
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
                onClick={() => {
                  if (window.confirm(`Drop stash@{${s.index}}?`)) {
                    void mutate(() => api.stashDrop(repoPath, s.index));
                  }
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
