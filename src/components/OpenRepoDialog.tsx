import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { api, GitlabProject } from '../api';

interface Props {
  open: boolean;
  defaultParent: string;
  onClose: () => void;
  onOpen: (path: string) => void;
  onCloned: (path: string) => void;
}

type DialogTab = 'local' | 'gitlab';
type GitlabState = 'loading' | 'ready' | 'unconfigured' | 'missing-token' | 'error';

const PAGE_SIZE = 100;

export default function OpenRepoDialog({
  open,
  defaultParent,
  onClose,
  onOpen,
  onCloned,
}: Props) {
  const [tab, setTab] = useState<DialogTab>('local');
  const [path, setPath] = useState('');
  const [parent, setParent] = useState(defaultParent);
  const [gitlabState, setGitlabState] = useState<GitlabState>('loading');
  const [projects, setProjects] = useState<GitlabProject[]>([]);
  const [projectFilter, setProjectFilter] = useState('');
  const [projectsPage, setProjectsPage] = useState(1);
  const [hasMoreProjects, setHasMoreProjects] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [cloningProject, setCloningProject] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTab('local');
    setPath('');
    setParent(defaultParent);
    setProjects([]);
    setProjectFilter('');
    setProjectsPage(1);
    setHasMoreProjects(false);
    setError(null);
    setGitlabState('loading');

    const loadProjects = async () => {
      try {
        const settings = await api.getGitlabSettings();
        if (cancelled) return;
        if (!settings.url.trim()) {
          setGitlabState('unconfigured');
          setTab('local');
          return;
        }
        if (!settings.hasToken) {
          setGitlabState('missing-token');
          return;
        }

        setProjectsLoading(true);
        const result = await api.getGitlabProjects(1);
        if (cancelled) return;
        setProjects(result);
        setHasMoreProjects(result.length === PAGE_SIZE);
        setGitlabState('ready');
      } catch (e) {
        if (!cancelled) {
          setGitlabState('error');
          setError(String(e));
        }
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    };

    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, [open, defaultParent]);

  if (!open) return null;

  const browse = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === 'string') {
      if (tab === 'local') setPath(selected);
      else setParent(selected);
    }
  };

  const submit = () => {
    const p = path.trim();
    if (p) onOpen(p);
  };

  const loadMoreProjects = async () => {
    const nextPage = projectsPage + 1;
    setProjectsLoading(true);
    setError(null);
    try {
      const result = await api.getGitlabProjects(nextPage);
      setProjects((current) => [...current, ...result]);
      setProjectsPage(nextPage);
      setHasMoreProjects(result.length === PAGE_SIZE);
    } catch (e) {
      setError(String(e));
    } finally {
      setProjectsLoading(false);
    }
  };

  const cloneProject = async (project: GitlabProject) => {
    setCloningProject(project.id);
    setError(null);
    try {
      const clonedPath = await api.cloneRepo(project.httpUrlToRepo, parent.trim());
      onCloned(clonedPath);
    } catch (e) {
      setError(String(e));
      setCloningProject(null);
    }
  };

  const filteredProjects = projects.filter((project) => {
    const query = projectFilter.trim().toLowerCase();
    return (
      !query ||
      project.name.toLowerCase().includes(query) ||
      project.pathWithNamespace.toLowerCase().includes(query) ||
      (project.description ?? '').toLowerCase().includes(query)
    );
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <h2>Open Repository</h2>
        <div className="dialog-tabs" role="tablist" aria-label="Repository source">
          <button
            className={`dialog-tab ${tab === 'local' ? 'active' : ''}`}
            role="tab"
            aria-selected={tab === 'local'}
            onClick={() => setTab('local')}
          >
            Local
          </button>
          {gitlabState !== 'unconfigured' && (
            <button
              className={`dialog-tab ${tab === 'gitlab' ? 'active' : ''}`}
              role="tab"
              aria-selected={tab === 'gitlab'}
              onClick={() => setTab('gitlab')}
            >
              GitLab
            </button>
          )}
        </div>

        {tab === 'local' ? (
          <>
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
          </>
        ) : (
          <>
            <p className="muted">Browse projects accessible to your configured GitLab account.</p>
            {gitlabState === 'loading' && <p className="muted gitlab-project-state">Loading GitLab…</p>}
            {gitlabState === 'unconfigured' && (
              <p className="muted gitlab-project-state">Configure a GitLab server in Settings to browse projects.</p>
            )}
            {gitlabState === 'missing-token' && (
              <p className="muted gitlab-project-state">Add an API token in GitLab Settings to browse projects.</p>
            )}
            {gitlabState === 'error' && (
              <p className="muted gitlab-project-state">Could not load projects. Check your GitLab settings and connection.</p>
            )}
            {gitlabState === 'ready' && (
              <>
                <label className="field">
                  <span>Clone into parent directory</span>
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
                <input
                  className="input gitlab-project-filter"
                  placeholder="Filter projects…"
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                />
                <div className="gitlab-project-list">
                  {filteredProjects.map((project) => (
                    <div className="gitlab-project-row" key={project.id}>
                      <div className="gitlab-project-info">
                        <strong>{project.name}</strong>
                        <span className="muted">{project.pathWithNamespace}</span>
                        {project.description && <span className="muted">{project.description}</span>}
                      </div>
                      <button
                        className="btn primary"
                        disabled={!parent.trim() || cloningProject !== null}
                        onClick={() => void cloneProject(project)}
                      >
                        {cloningProject === project.id ? 'Cloning…' : 'Clone & Open'}
                      </button>
                    </div>
                  ))}
                  {filteredProjects.length === 0 && (
                    <div className="panel-empty">
                      {projects.length === 0 ? 'No accessible projects found.' : 'No matching projects.'}
                    </div>
                  )}
                  {hasMoreProjects && (
                    <button
                      className="btn gitlab-load-more"
                      disabled={projectsLoading}
                      onClick={() => void loadMoreProjects()}
                    >
                      {projectsLoading ? 'Loading…' : 'Load more projects'}
                    </button>
                  )}
                </div>
              </>
            )}
            {error && <div className="settings-msg err">{error}</div>}
            <div className="modal-actions">
              <span className="spacer" />
              <button className="btn" onClick={onClose} disabled={cloningProject !== null}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
