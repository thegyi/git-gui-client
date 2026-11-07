import { useEffect, useState } from 'react';
import { api } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  initialProvider: 'gitlab' | 'github';
}

type Provider = 'gitlab' | 'github';

export default function SettingsDialog({ open, onClose, initialProvider }: Props) {
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [gitlabToken, setGitlabToken] = useState('');
  const [hasGitlabToken, setHasGitlabToken] = useState(false);
  const [githubToken, setGithubToken] = useState('');
  const [hasGithubToken, setHasGithubToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setProvider(initialProvider);
    setMessage(null);
    setGitlabToken('');
    setGithubToken('');
    Promise.all([api.getGitlabSettings(), api.getGitHubSettings()])
      .then(([gitlab, github]) => {
        setUrl(gitlab.url);
        setUsername(gitlab.username);
        setHasGitlabToken(gitlab.hasToken);
        setHasGithubToken(github.hasToken);
      })
      .catch((error) => setMessage({ kind: 'err', text: String(error) }));
  }, [open, initialProvider]);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (provider === 'gitlab') {
        await api.saveGitlabSettings(url.trim(), username.trim(), gitlabToken.trim() || undefined);
        setHasGitlabToken(hasGitlabToken || gitlabToken.trim().length > 0);
        setGitlabToken('');
      } else {
        await api.saveGitHubSettings(githubToken.trim() || undefined);
        setHasGithubToken(hasGithubToken || githubToken.trim().length > 0);
        setGithubToken('');
      }
      setMessage({ kind: 'ok', text: 'Settings saved.' });
    } catch (error) {
      setMessage({ kind: 'err', text: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const user = provider === 'gitlab'
        ? await api.testGitlabConnection(url.trim(), gitlabToken.trim() || undefined)
        : await api.testGitHubConnection(githubToken.trim() || undefined);
      setMessage({ kind: 'ok', text: `Connected — authenticated as "${user}".` });
    } catch (error) {
      setMessage({ kind: 'err', text: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (provider === 'gitlab') {
        await api.clearGitlabSettings();
        setUrl('');
        setUsername('');
        setGitlabToken('');
        setHasGitlabToken(false);
      } else {
        await api.clearGitHubSettings();
        setGithubToken('');
        setHasGithubToken(false);
      }
      setMessage({ kind: 'ok', text: `${provider === 'gitlab' ? 'GitLab' : 'GitHub'} settings removed.` });
    } catch (error) {
      setMessage({ kind: 'err', text: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h2>Settings</h2>
        <div className="dialog-tabs" role="tablist" aria-label="Provider settings">
          <button
            className={`dialog-tab ${provider === 'gitlab' ? 'active' : ''}`}
            role="tab"
            aria-selected={provider === 'gitlab'}
            onClick={() => { setProvider('gitlab'); setMessage(null); }}
          >
            GitLab
          </button>
          <button
            className={`dialog-tab ${provider === 'github' ? 'active' : ''}`}
            role="tab"
            aria-selected={provider === 'github'}
            onClick={() => { setProvider('github'); setMessage(null); }}
          >
            GitHub
          </button>
        </div>
        {provider === 'gitlab' ? (
          <>
            <p className="muted">
              For self-hosted GitLab. The token is stored in your OS keyring and
              used for browsing projects and authenticating matching remotes.
            </p>
            <label className="field">
              <span>GitLab URL</span>
              <input className="input" placeholder="https://gitlab.example.com" value={url} onChange={(event) => setUrl(event.target.value)} />
            </label>
            <label className="field">
              <span>Username</span>
              <input className="input" placeholder="gitlab username" value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label className="field">
              <span>API token {hasGitlabToken && <em className="token-saved">(saved)</em>}</span>
              <input
                className="input"
                type="password"
                placeholder={hasGitlabToken ? '•••••••• (leave empty to keep)' : 'personal access token'}
                value={gitlabToken}
                onChange={(event) => setGitlabToken(event.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <p className="muted">
              Add a GitHub personal access token to browse private and personal
              repositories. It is stored in your OS keyring and used for
              github.com HTTPS remotes. A token with repository read access is
              needed for private repositories.
            </p>
            <label className="field">
              <span>Personal access token {hasGithubToken && <em className="token-saved">(saved)</em>}</span>
              <input
                className="input"
                type="password"
                placeholder={hasGithubToken ? '•••••••• (leave empty to keep)' : 'github_pat_…'}
                value={githubToken}
                onChange={(event) => setGithubToken(event.target.value)}
              />
            </label>
          </>
        )}

        {message && <div className={`settings-msg ${message.kind}`}>{message.text}</div>}

        <div className="modal-actions">
          <button className="btn danger-ghost" onClick={() => void clear()} disabled={busy}>Remove</button>
          <span className="spacer" />
          <button className="btn" onClick={() => void test()} disabled={busy || (provider === 'gitlab' && !url.trim())}>
            Test connection
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>Close</button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}>
            {busy ? '…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
