import { useEffect, useState } from 'react';
import { api, RebaseCommit, RebaseItem } from '../api';

const ACTIONS = ['pick', 'squash', 'fixup', 'drop'] as const;
type Action = (typeof ACTIONS)[number];

interface Props {
  open: boolean;
  repoPath: string;
  /** Commit the rebase is rooted at; commits after it are rewritten. */
  base: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

export default function RebaseDialog({ open, repoPath, base, onClose, onDone }: Props) {
  const [commits, setCommits] = useState<RebaseCommit[] | null>(null);
  const [actions, setActions] = useState<Record<string, Action>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !base) return;
    setCommits(null);
    setError(null);
    setActions({});
    api
      .rebaseCommits(repoPath, base)
      .then((list) => {
        setCommits(list);
        setActions(Object.fromEntries(list.map((c) => [c.id, 'pick' as Action])));
      })
      .catch((e) => setError(String(e)));
  }, [open, repoPath, base]);

  if (!open || !base) return null;

  const setAction = (id: string, action: Action) =>
    setActions((a) => ({ ...a, [id]: action }));

  const execute = async () => {
    if (!commits) return;
    setBusy(true);
    setError(null);
    try {
      const items: RebaseItem[] = commits.map((c) => ({
        id: c.id,
        action: actions[c.id] ?? 'pick',
      }));
      const out = await api.rebaseExecute(repoPath, base, items);
      onDone(out || 'Rebase finished.');
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <h2>Interactive Rebase</h2>
        <p className="muted">
          Commits after <code>{base.slice(0, 7)}</code> will be rewritten onto
          it, in the order shown (oldest first). <b>squash</b> merges a commit
          into the one above it, <b>fixup</b> like squash but discards its
          message, <b>drop</b> removes it.
        </p>

        {error && <div className="settings-msg err">{error}</div>}

        <div className="rebase-list">
          {commits === null && !error && <div className="panel-empty">Loading…</div>}
          {commits?.length === 0 && (
            <div className="panel-empty">Nothing to rebase — no commits after this one.</div>
          )}
          {commits?.map((c, i) => (
            <div key={c.id} className="rebase-row">
              <select
                className="input rebase-action"
                value={actions[c.id] ?? 'pick'}
                onChange={(e) => setAction(c.id, e.target.value as Action)}
                disabled={busy}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <code className="rebase-sha">{c.shortId}</code>
              <span className="rebase-subject" title={c.subject}>
                {c.subject}
              </span>
              {i === 0 && <span className="menu-hint">applied first</span>}
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={execute}
            disabled={busy || !commits || commits.length === 0}
          >
            {busy ? 'Rebasing…' : 'Start rebase'}
          </button>
        </div>
      </div>
    </div>
  );
}
