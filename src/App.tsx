import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  BranchInfo,
  CommitDetails,
  CommitInfo,
  FileStatus,
  RepoInfo,
  StashInfo,
  TagInfo,
} from './api';
import Header from './components/Header';
import Welcome from './components/Welcome';
import TabBar from './components/TabBar';
import Sidebar, { SidebarTab } from './components/Sidebar';
import CommitList from './components/CommitList';
import BottomPanel from './components/BottomPanel';
import CommitBox from './components/CommitBox';
import SettingsDialog from './components/SettingsDialog';
import CloneDialog from './components/CloneDialog';
import OpenRepoDialog from './components/OpenRepoDialog';
import RebaseDialog from './components/RebaseDialog';

export type DiffTarget =
  | { kind: 'workdir'; path: string; staged: boolean }
  | { kind: 'commit'; hash: string; path: string };

export type BottomTab = 'diff' | 'commit';

const TABS_KEY = 'git-gui-client:open-tabs';
const LAST_REPO_KEY = 'git-gui-client:last-repo';

/** All per-repository state, kept independently per open tab. */
interface RepoTab {
  path: string;
  info: RepoInfo | null;
  status: FileStatus[];
  log: CommitInfo[];
  branches: BranchInfo[];
  tags: TagInfo[];
  stashes: StashInfo[];
  selectedCommit: string | null;
  commitDetails: CommitDetails | null;
  diffTarget: DiffTarget | null;
  scrollToId: string | null;
  dataVersion: number;
  loading: boolean;
}

const emptyTab = (path: string): RepoTab => ({
  path,
  info: null,
  status: [],
  log: [],
  branches: [],
  tags: [],
  stashes: [],
  selectedCommit: null,
  commitDetails: null,
  diffTarget: null,
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

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('changes');
  const [bottomTab, setBottomTab] = useState<BottomTab>('commit');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [rebaseTarget, setRebaseTarget] = useState<{ path: string; base: string } | null>(null);

  const active = tabs.find((t) => t.path === activePath) ?? null;

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
        const [info, st, lg, br, tg, sh] = await Promise.all([
          api.openRepo(path),
          api.getStatus(path),
          api.getLog(path, 300),
          api.getBranches(path),
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
                  log: lg,
                  branches: br,
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

  const refreshRemoteBranches = useCallback(
    async (path: string) => {
      try {
        await api.gitFetch(path);
        await loadAll(path);
      } catch (e) {
        setError(`Could not refresh remote branches: ${String(e)}`);
      }
    },
    [loadAll],
  );

  const openRepo = useCallback(
    async (path: string) => {
      setError(null);
      try {
        await api.openRepo(path); // validate before creating a tab
      } catch (e) {
        setError(String(e));
        return;
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

  // Restore open tabs on start.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TABS_KEY);
      if (raw) {
        const { paths, active } = JSON.parse(raw) as {
          paths?: string[];
          active?: string | null;
        };
        const jobs = (paths ?? []).map((p) => openRepo(p));
        void Promise.all(jobs).then(() => {
          if (active && (paths ?? []).includes(active)) setActivePath(active);
        });
        return;
      }
    } catch {
      /* corrupted state — fall through */
    }
    const last = localStorage.getItem(LAST_REPO_KEY);
    if (last) void openRepo(last);
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
    if (activePath) localStorage.setItem(LAST_REPO_KEY, activePath);
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
      if (!p) return;
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(String(e));
        return;
      }
      await loadAll(p);
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
    (path: string, staged: boolean) => {
      const p = activePathRef.current;
      if (p) patchTab(p, { diffTarget: { kind: 'workdir', path, staged } });
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
    async (kind: 'fetch' | 'pull' | 'push', fn: () => Promise<string>) => {
      const p = activePathRef.current;
      if (!p) return;
      setError(null);
      setNotice(null);
      setRemoteBusy(kind);
      try {
        const out = await fn();
        setNotice(out || 'Done.');
      } catch (e) {
        setError(String(e));
        setRemoteBusy(null);
        return;
      }
      setRemoteBusy(null);
      await loadAll(p);
    },
    [loadAll],
  );

  /** Jump the commit table to a commit (used by tag clicks). */
  const jumpToCommit = useCallback(
    async (commitId: string) => {
      const p = activePathRef.current;
      const tab = tabsRef.current.find((t) => t.path === p);
      if (!p || !tab || !commitId) return;
      if (!tab.log.some((c) => c.id === commitId)) {
        // Tagged commit may be older than the loaded window — fetch deeper.
        try {
          patchTab(p, { log: await api.getLog(p, 2000) });
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
        loading={active?.loading ?? false}
        remoteBusy={remoteBusy}
        onFetch={() =>
          activePath && void runRemote('fetch', () => api.gitFetch(activePath))
        }
        onPull={() =>
          activePath && void runRemote('pull', () => api.gitPull(activePath))
        }
        onPush={() =>
          activePath && void runRemote('push', () => api.gitPush(activePath))
        }
        onOpenSettings={() => setSettingsOpen(true)}
        onClone={() => setCloneOpen(true)}
        onOpenRepo={() => setOpenDialogOpen(true)}
        onRefresh={() => activePath && loadAll(activePath)}
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
        <Welcome onOpen={(p) => void openRepo(p)} />
      ) : (
        <div className="main">
          <Sidebar
            tab={sidebarTab}
            onTabChange={setSidebarTab}
            status={active.status}
            branches={active.branches}
            tags={active.tags}
            stashes={active.stashes}
            selectedCommit={active.selectedCommit}
            repoPath={active.path}
            isBare={active.info?.isBare ?? false}
            repoState={active.info?.state ?? 'clean'}
            mutate={mutate}
            onSelectFile={openWorkdirDiff}
            onJumpToCommit={jumpToCommit}
          />
          <section className="center">
            <CommitList
              commits={active.log}
              selectedId={active.selectedCommit}
              scrollToId={active.scrollToId}
              onSelect={selectCommit}
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
              onRebase={
                active.info?.isBare
                  ? undefined
                  : (id) => activePath && setRebaseTarget({ path: activePath, base: id })
              }
            />
          </section>
          <CommitBox
            repoPath={active.path}
            isBare={active.info?.isBare ?? false}
            stagedCount={active.status.filter((f) => f.staged).length}
            mutate={mutate}
          />
        </div>
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
