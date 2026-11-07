import { useEffect, useState } from 'react';
import { api } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ open, onClose }: Props) {
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setToken('');
    api
      .getGitlabSettings()
      .then((s) => {
        setUrl(s.url);
        setUsername(s.username);
        setHasToken(s.hasToken);
      })
      .catch((e) => setMessage({ kind: 'err', text: String(e) }));
  }, [open]);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.saveGitlabSettings(url.trim(), username.trim(), token.trim() || undefined);
      setHasToken(hasToken || token.trim().length > 0);
      setToken('');
      setMessage({ kind: 'ok', text: 'Settings saved.' });
    } catch (e) {
      setMessage({ kind: 'err', text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const user = await api.testGitlabConnection(url.trim(), token.trim() || undefined);
      setMessage({ kind: 'ok', text: `Connected — authenticated as "${user}".` });
    } catch (e) {
      setMessage({ kind: 'err', text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.clearGitlabSettings();
      setUrl('');
      setUsername('');
      setToken('');
      setHasToken(false);
      setMessage({ kind: 'ok', text: 'GitLab settings removed.' });
    } catch (e) {
      setMessage({ kind: 'err', text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>GitLab Settings</h2>
        <p className="muted">
          For self-hosted GitLab. When an opened repository has a remote on this
          host, fetch / pull / push authenticate automatically with the API
          token. Browse and clone accessible projects from the Open Repository
          dialog. The token is stored in your OS keyring.
        </p>

        <label className="field">
          <span>GitLab URL</span>
          <input
            className="input"
            placeholder="https://gitlab.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Username</span>
          <input
            className="input"
            placeholder="gitlab username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          <span>
            API Token {hasToken && <em className="token-saved">(saved)</em>}
          </span>
          <input
            className="input"
            type="password"
            placeholder={hasToken ? '•••••••• (leave empty to keep)' : 'personal access token'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>

        {message && (
          <div className={`settings-msg ${message.kind}`}>{message.text}</div>
        )}

        <div className="modal-actions">
          <button className="btn danger-ghost" onClick={clear} disabled={busy}>
            Remove
          </button>
          <span className="spacer" />
          <button className="btn" onClick={test} disabled={busy || !url.trim()}>
            Test connection
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? '…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
