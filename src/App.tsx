import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  api,
  BranchInfo,
  BisectState,
  CommitDetails,
  ResetMode,
  CommitInfo,
  FileStatus,
  RepoInfo,
  RemoteInfo,
  ReflogEntry,
  StashInfo,
  TagInfo,
  WorktreeInfo,
} from './api';
import Header from './components/Header';
import Welcome from './components/Welcome';
import TabBar from './components/TabBar';
import Sidebar, { SidebarTab } from './components/Sidebar';
import ChangesPanel from './components/ChangesPanel';
import CommitList from './components/CommitList';
import BottomPanel from './components/BottomPanel';
import CommitBox from './components/CommitBox';
import SettingsDialog from './components/SettingsDialog';
import CloneDialog from './components/CloneDialog';
import OpenRepoDialog from './components/OpenRepoDialog';
import RebaseDialog from './components/RebaseDialog';
import InitRepoDialog from './components/InitRepoDialog';

export type DiffTarget =
  | { kind: 'workdir'; path: string; staged: boolean; untracked: boolean }
  | { kind: 'commit'; hash: string; path: string };

export type BottomTab = 'diff' | 'commit' | 'file-history';

const TABS_KEY = 'git-gui-client:open-tabs';
const LAST_REPO_KEY = 'git-gui-client:last-repo';
const RECENT_REPOS_KEY = 'git-gui-client:recent-repos';
const RECENT_REPOS_MAX = 10;
const REMOTE_OPTIONS_PREFIX = 'git-gui-client:remote-options:';
const HISTORY_PAGE_SIZE = 300;

interface RemoteOptions {
  pruneOnFetch: boolean;
  forceWithLease: boolean;
}

const DEFAULT_REMOTE_OPTIONS: RemoteOptions = {
  pruneOnFetch: true,
  forceWithLease: false,
};

function readRecentRepos(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_REPOS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter((p): p is string => typeof p === 'string')
          .slice(0, RECENT_REPOS_MAX)
      : [];
  } catch {
    return [];
  }
}

function readRemoteOptions(path: string): RemoteOptions {
  try {
    const stored = localStorage.getItem(`${REMOTE_OPTIONS_PREFIX}${path}`);
    if (!stored) return DEFAULT_REMOTE_OPTIONS;
    const options = JSON.parse(stored) as Partial<RemoteOptions>;
    return {
      pruneOnFetch: typeof options.pruneOnFetch === 'boolean'
        ? options.pruneOnFetch
        : DEFAULT_REMOTE_OPTIONS.pruneOnFetch,
      forceWithLease: typeof options.forceWithLease === 'boolean'
        ? options.forceWithLease
        : DEFAULT_REMOTE_OPTIONS.forceWithLease,
    };
  } catch {
    return DEFAULT_REMOTE_OPTIONS;
  }
}

/** All per-repository state, kept independently per open tab. */
interface RepoTab {
  path: string;
  info: RepoInfo | null;
  status: FileStatus[];
  log: CommitInfo[];
  hasMoreHistory: boolean;
  loadingOlderHistory: boolean;
  branches: BranchInfo[];
  remotes: RemoteInfo[];
  worktrees: WorktreeInfo[];
  reflog: ReflogEntry[];
  bisectState: BisectState;
  selectedRemote: string;
  remoteOptions: RemoteOptions;
  tags: TagInfo[];
  stashes: StashInfo[];
  selectedCommit: string | null;
  commitDetails: CommitDetails | null;
  diffTarget: DiffTarget | null;
  fileHistoryPath: string | null;
  scrollToId: string | null;
  dataVersion: number;
  loading: boolean;
}

const emptyTab = (path: string): RepoTab => ({
  path,
  info: null,
  status: [],
  log: [],
  hasMoreHistory: false,
  loadingOlderHistory: false,
  branches: [],
  remotes: [],
  worktrees: [],
  reflog: [],
  bisectState: { active: false, currentCommit: null, shortId: null, subject: null },
  selectedRemote: '',
  remoteOptions: readRemoteOptions(path),
  tags: [],
  stashes: [],
  selectedCommit: null,
  commitDetails: null,
  diffTarget: null,
  fileHistoryPath: null,
  scrollToId: null,
  dataVersion: 0,
  loading: false,
});

export default function App() {
  const [tabs, setTabs] = useState<RepoTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState<string | null>(null);

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('branches');
  const [bottomTab, setBottomTab] = useState<BottomTab>('commit');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsProvider, setSettingsProvider] = useState<'gitlab' | 'github'>('gitlab');
  const [cloneOpen, setCloneOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [initRepoOpen, setInitRepoOpen] = useState(false);
  const [rebaseTarget, setRebaseTarget] = useState<{ path: string; base: string } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [recentRepos, setRecentRepos] = useState<string[]>(readRecentRepos);

  const active = tabs.find((t) => t.path === activePath) ?? null;

  const toggleFullscreen = useCallback(async () => {
    try {
      if (isTauri()) {
        const appWindow = getCurrentWindow();
        const fullscreen = await appWindow.isFullscreen();
        await appWindow.setFullscreen(!fullscreen);
        setIsFullscreen(!fullscreen);
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (e) {
      setError(`Could not change fullscreen mode: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      const syncFullscreen = () => setIsFullscreen(document.fullscreenElement !== null);
      document.addEventListener('fullscreenchange', syncFullscreen);
      syncFullscreen();
      return () => document.removeEventListener('fullscreenchange', syncFullscreen);
    }

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const syncFullscreen = async () => {
      try {
        const fullscreen = await appWindow.isFullscreen();
        if (!disposed) setIsFullscreen(fullscreen);
      } catch (e) {
        if (!disposed) setError(`Could not read fullscreen mode: ${String(e)}`);
      }
    };

    void syncFullscreen();
    void appWindow.onResized(() => void syncFullscreen()).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    }).catch((e: unknown) => {
      if (!disposed) setError(`Could not monitor fullscreen mode: ${String(e)}`);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F11' && !event.repeat) {
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleFullscreen]);

  const tabsRef = useRef<RepoTab[]>([]);
  tabsRef.current = tabs;
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activePath;

  const patchTab = useCallback((path: string, patch: Partial<RepoTab>) => {
    setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, ...patch } : t)));
  }, []);

  const loadAll = useCallback(
    async (path: string, quiet = false) => {
      if (!quiet) patchTab(path, { loading: true });
      try {
        const loadedHistoryCount = Math.max(
          HISTORY_PAGE_SIZE,
          tabsRef.current.find((tab) => tab.path === path)?.log.length ?? 0,
        );
        const [info, st, lg, br, rm, wt, rl, bs, tg, sh] = await Promise.all([
          api.openRepo(path),
          api.getStatus(path),
          api.getLog(path, loadedHistoryCount + 1),
          api.getBranches(path),
          api.getRemotes(path),
          api.getWorktrees(path),
          api.getReflog(path),
          api.getBisectState(path),
          api.getTags(path),
          api.getStashes(path),
        ]);
        setTabs((ts) =>
          ts.map((t) =>
            t.path === path
              ? {
                  ...t,
                  info,
                  status: st,
                  log:
                    t.log.length > loadedHistoryCount
                      ? [
                          ...lg.slice(0, loadedHistoryCount),
                          ...t.log.slice(loadedHistoryCount),
                        ]
                      : lg.slice(0, loadedHistoryCount),
                  hasMoreHistory:
                    t.log.length > loadedHistoryCount
                      ? t.hasMoreHistory
                      : lg.length > loadedHistoryCount,
                  branches: br,
                  remotes: rm,
                  worktrees: wt,
                  reflog: rl,
                  bisectState: bs,
                  selectedRemote: rm.some((remote) => remote.name === t.selectedRemote)
                    ? t.selectedRemote
                    : rm.find((remote) => remote.name === 'origin')?.name ?? rm[0]?.name ?? '',
                  tags: tg,
                  stashes: sh,
                  // Only bump dataVersion on explicit loads — the 5s
                  // background poll must not refetch diffs/details (it
                  // resets Monaco's scroll position).
                  dataVersion: quiet ? t.dataVersion : t.dataVersion + 1,
                }
              : t,
          ),
        );
        if (!quiet) setError(null);
      } catch (e) {
        if (!quiet) setError(String(e));
      } finally {
        if (!quiet) patchTab(path, { loading: false });
      }
    },
    [patchTab],
  );

  const openFileHistory = useCallback(
    (path: string) => {
      const p = activePathRef.current;
      if (p) patchTab(p, { fileHistoryPath: path });
      setBottomTab('file-history');
    },
    [patchTab],
  );

  const loadOlderHistory = useCallback(async (path: string) => {
    const tab = tabsRef.current.find((item) => item.path === path);
    const cursor = tab?.log[tab.log.length - 1]?.id;
    if (!tab || !cursor || tab.loadingOlderHistory || !tab.hasMoreHistory) return;

    patchTab(path, { loadingOlderHistory: true });
    try {
      const page = await api.getOlderLog(path, cursor, HISTORY_PAGE_SIZE + 1);
      setTabs((current) =>
        current.map((item) => {
          if (item.path !== path) return item;
          const known = new Set(item.log.map((commit) => commit.id));
          const next = page.slice(0, HISTORY_PAGE_SIZE).filter((commit) => !known.has(commit.id));
          return {
            ...item,
            log: [...item.log, ...next],
            hasMoreHistory: page.length > HISTORY_PAGE_SIZE,
            loadingOlderHistory: false,
          };
        }),
      );
    } catch (e) {
      setError(`Could not load older history: ${String(e)}`);
      patchTab(path, { loadingOlderHistory: false });
    }
  }, [patchTab]);

  const refreshRemoteBranches = useCallback(
    async (path: string) => {
      try {
        await api.gitFetch(path, undefined, readRemoteOptions(path).pruneOnFetch);
        await loadAll(path);
      } catch (e) {
        setError(`Could not refresh remote branches: ${String(e)}`);
      }
    },
    [loadAll],
  );

  const openRepo = useCallback(
    async (path: string, recordHistory = true) => {
      setError(null);
      try {
        await api.openRepo(path); // validate before creating a tab
      } catch (e) {
        setError(String(e));
        return;
      }
      if (recordHistory) {
        setRecentRepos((current) => {
          const next = [path, ...current.filter((p) => p !== path)].slice(
            0,
            RECENT_REPOS_MAX,
          );
          try {
            localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(next));
          } catch {
            /* storage unavailable */
          }
          return next;
        });
      }
      setActivePath(path);
      setTabs((ts) => (ts.some((t) => t.path === path) ? ts : [...ts, emptyTab(path)]));
      await loadAll(path);
      void refreshRemoteBranches(path);
    },
    [loadAll, refreshRemoteBranches],
  );

  const closeTab = useCallback((path: string) => {
    const ts = tabsRef.current;
    const idx = ts.findIndex((t) => t.path === path);
    const next = ts.filter((t) => t.path !== path);
    if (path === activePathRef.current) {
      const neighbor = next[Math.min(idx, next.length - 1)];
      setActivePath(neighbor ? neighbor.path : null);
    }
    setTabs(next);
  }, []);

  const removeRecentRepo = useCallback((path: string) => {
    setRecentRepos((current) => {
      const next = current.filter((p) => p !== path);
      try {
        if (next.length > 0) {
          localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(next));
        } else {
          localStorage.removeItem(RECENT_REPOS_KEY);
        }
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  // Restore open tabs on start.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TABS_KEY);
      if (raw) {
        const { paths, active } = JSON.parse(raw) as {
          paths?: string[];
          active?: string | null;
        };
        const jobs = (paths ?? []).map((p) => openRepo(p, false));
        void Promise.all(jobs).then(() => {
          if (active && (paths ?? []).includes(active)) setActivePath(active);
        });
        return;
      }
    } catch {
      /* corrupted state — fall through */
    }
    const last = localStorage.getItem(LAST_REPO_KEY);
    if (last) void openRepo(last, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist tabs.
  const tabPaths = tabs.map((t) => t.path).join('\n');
  useEffect(() => {
    if (tabPaths) {
      localStorage.setItem(
        TABS_KEY,
        JSON.stringify({ paths: tabPaths.split('\n'), active: activePath }),
      );
    } else {
      localStorage.removeItem(TABS_KEY);
    }
    if (activePath) {
      localStorage.setItem(LAST_REPO_KEY, activePath);
    } else {
      localStorage.removeItem(LAST_REPO_KEY);
    }
  }, [tabPaths, activePath]);

  // Background refresh so external git operations show up — all open repos.
  useEffect(() => {
    const t = setInterval(() => {
      for (const tab of tabsRef.current) void loadAll(tab.path, true);
    }, 5000);
    return () => clearInterval(t);
  }, [loadAll]);

  // Load commit details when the active repo's selection changes.
  const detailsReq = useRef(0);
  const activeSelected = active?.selectedCommit ?? null;
  const activeDataVersion = active?.dataVersion ?? 0;
  useEffect(() => {
    if (!activePath) return;
    if (!activeSelected) {
      patchTab(activePath, { commitDetails: null });
      return;
    }
    const req = ++detailsReq.current;
    const p = activePath;
    const id = activeSelected;
    api
      .getCommitDetails(p, id)
      .then((d) => {
        if (detailsReq.current === req) patchTab(p, { commitDetails: d });
      })
      .catch((e) => {
        if (detailsReq.current === req) setError(String(e));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, activeSelected, activeDataVersion, patchTab]);

  /** Run a mutation on the active repo then refresh it. */
  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      const p = activePathRef.current;
      if (!p) return false;
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(String(e));
        return false;
      }
      await loadAll(p);
      return true;
    },
    [loadAll],
  );

  const runCommitAction = useCallback(
    async (action: (path: string) => Promise<unknown>) => {
      const p = activePathRef.current;
      if (!p) return;
      setError(null);
      try {
        await action(p);
      } catch (e) {
        setError(String(e));
      }
      await loadAll(p);
    },
    [loadAll],
  );

  const resolveConflictManually = useCallback(
    async (path: string, file: string, content: string): Promise<boolean> => {
      setError(null);
      try {
        await api.resolveConflictManually(path, file, content);
        await loadAll(path);
        return true;
      } catch (e) {
        setError(String(e));
        await loadAll(path);
        return false;
      }
    },
    [loadAll],
  );

  const selectCommit = useCallback(
    (id: string) => {
      const p = activePathRef.current;
      if (p) patchTab(p, { selectedCommit: id });
      setBottomTab('commit');
    },
    [patchTab],
  );

  const openWorkdirDiff = useCallback(
    (path: string, staged: boolean, untracked: boolean) => {
      const p = activePathRef.current;
      if (p) patchTab(p, { diffTarget: { kind: 'workdir', path, staged, untracked } });
      setBottomTab('diff');
    },
    [patchTab],
  );

  const openCommitDiff = useCallback(
    (hash: string, path: string) => {
      const p = activePathRef.current;
      if (p) patchTab(p, { diffTarget: { kind: 'commit', hash, path } });
      setBottomTab('diff');
    },
    [patchTab],
  );

  /** Run a fetch/pull/push, surface git's output, then refresh. */
  const runRemote = useCallback(
    async (
      kind: 'fetch' | 'pull' | 'push' | 'push-tags' | 'delete-tag',
      fn: () => Promise<string>,
    ) => {
      const p = activePathRef.current;
      if (!p) return false;
      setError(null);
      setNotice(null);
      setRemoteBusy(kind);
      try {
        const out = await fn();
        setNotice(out || 'Done.');
      } catch (e) {
        setError(String(e));
        setRemoteBusy(null);
        return false;
      }
      setRemoteBusy(null);
      await loadAll(p);
      return true;
    },
    [loadAll],
  );

  const openReviewLink = useCallback(async () => {
    const path = activePathRef.current;
    const tab = tabsRef.current.find((item) => item.path === path);
    if (!path || !tab?.selectedRemote || !tab.info?.branch) return;
    setError(null);
    try {
      const link = await api.getReviewLink(path, tab.selectedRemote, tab.info.branch);
      await openUrl(link.url);
      setNotice(`Opened ${link.provider} review page for ${tab.info.branch}.`);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /** Jump the commit table to a commit (used by tag clicks). */
  const jumpToCommit = useCallback(
    async (commitId: string) => {
      const p = activePathRef.current;
      const tab = tabsRef.current.find((t) => t.path === p);
      if (!p || !tab || !commitId) return;
      if (!tab.log.some((c) => c.id === commitId)) {
        // Tagged commit may be older than the loaded window — fetch deeper.
        try {
          const visibleCount = Math.max(2000, tab.log.length);
          const log = await api.getLog(p, visibleCount + 1);
          patchTab(p, {
            log: log.slice(0, visibleCount),
            hasMoreHistory: log.length > visibleCount,
          });
        } catch (e) {
          setError(String(e));
          return;
        }
      }
      patchTab(p, {
        selectedCommit: commitId,
        scrollToId: null,
      });
      setBottomTab('commit');
      // Reset first so clicking the same tag twice still re-scrolls.
      requestAnimationFrame(() => patchTab(p, { scrollToId: commitId }));
    },
    [patchTab],
  );

  const tabNames = tabs.map((t) => ({
    path: t.path,
    name: t.info?.name ?? t.path.split('/').filter(Boolean).pop() ?? t.path,
  }));

  return (
    <div className="app">
      <Header
        repoInfo={active?.info ?? null}
        remotes={active?.remotes ?? []}
        branches={active?.branches ?? []}
        selectedRemote={active?.selectedRemote ?? ''}
        onRemoteChange={(remote) => activePath && patchTab(activePath, { selectedRemote: remote })}
        loading={active?.loading ?? false}
        remoteBusy={remoteBusy}
        onFetch={() =>
          activePath &&
          void runRemote('fetch', () =>
            api.gitFetch(
              activePath,
              active?.selectedRemote || undefined,
              active?.remoteOptions.pruneOnFetch ?? DEFAULT_REMOTE_OPTIONS.pruneOnFetch,
            ),
          )
        }
        onPull={(remote, branch, strategy) =>
          activePath &&
          void runRemote('pull', () => api.gitPull(activePath, remote, branch, strategy))
        }
        onPush={() =>
          activePath &&
          void runRemote('push', () =>
            api.gitPush(
              activePath,
              active?.selectedRemote || undefined,
              active?.remoteOptions.forceWithLease ?? DEFAULT_REMOTE_OPTIONS.forceWithLease,
            ),
          )
        }
        onCreateReview={() => void openReviewLink()}
        remoteOptions={active?.remoteOptions ?? DEFAULT_REMOTE_OPTIONS}
        onRemoteOptionChange={(key, enabled) => {
          if (!activePath || !active) return;
          const options = { ...active.remoteOptions, [key]: enabled };
          try {
            localStorage.setItem(`${REMOTE_OPTIONS_PREFIX}${activePath}`, JSON.stringify(options));
            patchTab(activePath, { remoteOptions: options });
          } catch (e) {
            setError(`Could not save remote options: ${String(e)}`);
          }
        }}
        onOpenSettings={() => {
          setSettingsProvider('gitlab');
          setSettingsOpen(true);
        }}
        onClone={() => setCloneOpen(true)}
        onOpenRepo={() => setOpenDialogOpen(true)}
        onRefresh={() => activePath && loadAll(activePath)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => void toggleFullscreen()}
      />
      {error && (
        <div className="error-banner" onClick={() => setError(null)} title="Click to dismiss">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice-banner" onClick={() => setNotice(null)} title="Click to dismiss">
          {notice}
        </div>
      )}
      <TabBar
        tabs={tabNames}
        activePath={activePath}
        onSelect={setActivePath}
        onClose={closeTab}
        onNew={() => setOpenDialogOpen(true)}
      />
      {!active ? (
        <Welcome
          onOpen={(p) => void openRepo(p)}
          onCreate={() => setInitRepoOpen(true)}
          recentRepos={recentRepos}
          onRemoveRecent={removeRecentRepo}
        />
      ) : (
        <div className="main">
          <Sidebar
            tab={sidebarTab}
            onTabChange={setSidebarTab}
            status={active.status}
            branches={active.branches}
            remotes={active.remotes}
            worktrees={active.worktrees}
            reflog={active.reflog}
            bisectState={active.bisectState}
            tags={active.tags}
            stashes={active.stashes}
            selectedCommit={active.selectedCommit}
            selectedRemote={active.selectedRemote}
            remoteBusy={remoteBusy}
            repoPath={active.path}
            isBare={active.info?.isBare ?? false}
            repoState={active.info?.state ?? 'clean'}
            mutate={mutate}
            onResolveConflictManually={resolveConflictManually}
            onSelectFile={openWorkdirDiff}
            onJumpToCommit={jumpToCommit}
            onPushTags={async () => {
              if (!activePath || !active.selectedRemote) return false;
              return runRemote('push-tags', () =>
                api.gitPushTags(activePath, active.selectedRemote),
              );
            }}
            onDeleteTag={(name) => {
              if (!active.selectedRemote) {
                return mutate(() => api.deleteTag(active.path, name));
              }
              return runRemote('delete-tag', () =>
                api.deleteTag(active.path, name, active.selectedRemote),
              );
            }}
            onOpenWorktree={(path) => void openRepo(path)}
            onOpenSubmodule={(path) => void openRepo(path)}
          />
          <section className="center">
            <CommitList
              repoPath={active.path}
              commits={active.log}
              selectedId={active.selectedCommit}
              scrollToId={active.scrollToId}
              hasMoreHistory={active.hasMoreHistory}
              loadingOlderHistory={active.loadingOlderHistory}
              onLoadOlder={() => void loadOlderHistory(active.path)}
              actionsDisabled={
                (active.info?.isBare ?? false) || (active.info?.state ?? 'clean') !== 'clean'
              }
              onSelect={selectCommit}
              onCherryPick={(id) =>
                void runCommitAction((path) => api.cherryPickCommit(path, id))
              }
              onRevert={(id) => void runCommitAction((path) => api.revertCommit(path, id))}
              onReset={(id, mode: ResetMode) =>
                void runCommitAction((path) => api.resetToCommit(path, id, mode))
              }
            />
            <BottomPanel
              tab={bottomTab}
              onTabChange={setBottomTab}
              diffTarget={active.diffTarget}
              repoPath={active.path}
              commitDetails={active.commitDetails}
              dataVersion={active.dataVersion}
              onOpenCommitDiff={openCommitDiff}
              onClearDiff={() => patchTab(active.path, { diffTarget: null })}
              fileHistoryPath={active.fileHistoryPath}
              onOpenFileHistory={openFileHistory}
              mutate={mutate}
              onRebase={
                active.info?.isBare
                  ? undefined
                  : (id) => activePath && setRebaseTarget({ path: activePath, base: id })
              }
            />
          </section>
          <aside className="right-panel">
            <section className="changes-section">
              <h3 className="changes-heading">
                Changes
                {active.status.some((f) => f.staged || f.unstaged || f.untracked) && (
                  <span className="count">
                    {active.status.filter((f) => f.staged || f.unstaged || f.untracked).length}
                  </span>
                )}
              </h3>
              <div className="changes-list">
                <ChangesPanel
                  status={active.status}
                  repoPath={active.path}
                  isBare={active.info?.isBare ?? false}
                  repoState={active.info?.state ?? 'clean'}
                  mutate={mutate}
                  onResolveConflictManually={resolveConflictManually}
                  onSelectFile={openWorkdirDiff}
                />
              </div>
            </section>
            <CommitBox
              repoPath={active.path}
              isBare={active.info?.isBare ?? false}
              stagedCount={active.status.filter((f) => f.staged).length}
              mutate={mutate}
            />
          </aside>
        </div>
      )}
      <SettingsDialog
        open={settingsOpen}
        initialProvider={settingsProvider}
        onClose={() => setSettingsOpen(false)}
      />
      <CloneDialog
        open={cloneOpen}
        defaultParent={
          activePath ? activePath.split('/').slice(0, -1).join('/') || '/' : '/'
        }
        onClose={() => setCloneOpen(false)}
        onCloned={(path) => {
          setCloneOpen(false);
          void openRepo(path);
        }}
      />
      <OpenRepoDialog
        open={openDialogOpen}
        defaultParent={
          activePath ? activePath.split('/').slice(0, -1).join('/') || '/' : '/'
        }
        onClose={() => setOpenDialogOpen(false)}
        onOpen={(p) => {
          setOpenDialogOpen(false);
          void openRepo(p);
        }}
        onCloned={(path) => {
          setOpenDialogOpen(false);
          void openRepo(path);
        }}
        onCreate={() => setInitRepoOpen(true)}
        onOpenSettings={() => {
          setOpenDialogOpen(false);
          setSettingsProvider('github');
          setSettingsOpen(true);
        }}
      />
      <InitRepoDialog
        open={initRepoOpen}
        defaultPath={
          activePath
            ? `${activePath.split('/').slice(0, -1).join('/') || '/'}/new-repository`
            : ''
        }
        onClose={() => setInitRepoOpen(false)}
        onCreated={(path) => {
          setInitRepoOpen(false);
          void openRepo(path);
        }}
      />
      <RebaseDialog
        open={rebaseTarget !== null}
        repoPath={rebaseTarget?.path ?? ''}
        base={rebaseTarget?.base ?? null}
        onClose={() => setRebaseTarget(null)}
        onDone={(msg) => {
          const p = rebaseTarget?.path;
          setRebaseTarget(null);
          setNotice(msg);
          if (p) void loadAll(p);
        }}
      />
    </div>
  );
}
