import { useState } from 'react';
import { api } from '../api';
import type { Mutate } from './Sidebar';

interface Props {
  repoPath: string;
  isBare: boolean;
  stagedCount: number;
  mutate: Mutate;
}

export default function CommitBox({ repoPath, isBare, stagedCount, mutate }: Props) {
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [committing, setCommitting] = useState(false);

  const doCommit = async () => {
    const msg = message.trim();
    if (!msg && !amend) return;
    setCommitting(true);
    try {
      await mutate(() => api.commit(repoPath, msg, amend));
      setMessage('');
      setAmend(false);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <aside className="commit-box">
      <h3>Commit</h3>
      <textarea
        className="input commit-msg"
        placeholder={amend ? 'Amend message (empty = keep)' : 'Commit message…'}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void doCommit();
        }}
        disabled={isBare || committing}
        rows={6}
      />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={amend}
          onChange={(e) => setAmend(e.target.checked)}
          disabled={isBare}
        />
        Amend last commit
      </label>
      <div className="commit-meta">
        <span>
          {stagedCount} staged file{stagedCount === 1 ? '' : 's'}
        </span>
        <span className="hint">Ctrl+Enter to commit</span>
      </div>
      <button
        className="btn primary block"
        disabled={isBare || committing || (!message.trim() && !amend)}
        onClick={() => void doCommit()}
      >
        {committing ? 'Committing…' : amend ? 'Amend Commit' : 'Commit'}
      </button>
      {isBare && <div className="panel-empty">Bare repository — commits disabled.</div>}
    </aside>
  );
}
