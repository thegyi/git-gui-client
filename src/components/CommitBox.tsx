import { useState, type KeyboardEvent } from 'react';
import { api } from '../api';
import type { Mutate } from './Sidebar';

interface Props {
  repoPath: string;
  isBare: boolean;
  stagedCount: number;
  mutate: Mutate;
}

export default function CommitBox({ repoPath, isBare, stagedCount, mutate }: Props) {
  const [shortMessage, setShortMessage] = useState('');
  const [longMessage, setLongMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [committing, setCommitting] = useState(false);

  const doCommit = async () => {
    const msg = [shortMessage.trim(), longMessage.trim()].filter(Boolean).join('\n\n');
    if (!msg && !amend) return;
    setCommitting(true);
    try {
      await mutate(() => api.commit(repoPath, msg, amend));
      setShortMessage('');
      setLongMessage('');
      setAmend(false);
    } finally {
      setCommitting(false);
    }
  };

  const handleCommitShortcut = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void doCommit();
    }
  };

  return (
    <aside className="commit-box">
      <h3>Commit</h3>
      <label className="commit-field">
        <span>Short message</span>
        <input
          className="input commit-subject"
          placeholder="Summary"
          value={shortMessage}
          onChange={(e) => setShortMessage(e.target.value)}
          onKeyDown={handleCommitShortcut}
          disabled={isBare || committing}
        />
      </label>
      <label className="commit-field">
        <span>Long message</span>
        <textarea
          className="input commit-body"
          placeholder="Description (optional)"
          value={longMessage}
          onChange={(e) => setLongMessage(e.target.value)}
          onKeyDown={handleCommitShortcut}
          disabled={isBare || committing}
        />
      </label>
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
        <span className="hint">
          Ctrl+Enter to commit{amend && ' · Empty message keeps existing'}
        </span>
      </div>
      <button
        className="btn primary block"
        disabled={isBare || committing || (!shortMessage.trim() && !longMessage.trim() && !amend)}
        onClick={() => void doCommit()}
      >
        {committing ? 'Committing…' : amend ? 'Amend Commit' : 'Commit'}
      </button>
      {isBare && <div className="panel-empty">Bare repository — commits disabled.</div>}
    </aside>
  );
}
