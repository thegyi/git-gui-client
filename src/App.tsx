import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  BranchInfo,
  CommitDetails,
  CommitInfo,
  FileStatus,
  RepoInfo,
  TagInfo,
} from './api';
import Header from './components/Header';
import Welcome from './components/Welcome';
import Sidebar from './components/Sidebar';
import CommitList from './components/CommitList';
import BottomPanel from './components/BottomPanel';
import CommitBox from './components/CommitBox';
import SettingsDialog from './components/SettingsDialog';

export type DiffTarget =
  | { kind: 'workdir'; path: string; staged: boolean }
  | { kind: 'commit'; hash: string; path: string };

export type BottomTab = 'diff' | 'commit';

const LAST_REPO_KEY = 'git-gui-client:last-repo';

export default function App() {
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [status, setStatus] = useState<FileStatus[]>([]);
  const [log, setLog] = useState<CommitInfo[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const [sidebarTab, setSidebarTab] = useState<'changes' | 'branches' | 'tags'>('changes');
  const [bottomTab, setBottomTab] = useState<BottomTab>('commit');
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [commitDetails, setCommitDetails] = useState<CommitDetails | null>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [scrollToId, setScrollToId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const repoPathRef = useRef<string | null>(null);
  repoPathRef.current = repoPath;

  const loadAll = useCallback(async (path: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [info, st, lg, br, tg] = await Promise.all([
        api.openRepo(path),
        api.getStatus(path),
        api.getLog(path, 300),
        api.getBranches(path),
        api.getTags(path),
      ]);
      setRepoInfo(info);
      setStatus(st);
      setLog(lg);
      setBranches(br);
      setTags(tg);
      // Only bump dataVersion on explicit loads — the 5s background poll
      // must not refetch diffs/details (it resets Monaco's scroll position).
      if (!quiet) setDataVersion((v) => v + 1);
      setError(null);
    } catch (e) {
      if (!quiet) setError(String(e));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const openRepo = useCallback(
    async (path: string) => {
      setError(null);
      setLoading(true);
      try {
        await api.openRepo(path); // validate
      } catch (e) {
        setError(String(e));
        setLoading(false);
        return;
      }
      setRepoPath(path);
      setRepoInfo(null);
      setSelectedCommit(null);
      setCommitDetails(null);
      setDiffTarget(null);
      localStorage.setItem(LAST_REPO_KEY, path);
      await loadAll(path);
    },
    [loadAll],
  );

  // Auto-open last repo on start.
  useEffect(() => {
    const last = localStorage.getItem(LAST_REPO_KEY);
    if (last) void openRepo(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background refresh so external git operations show up.
  useEffect(() => {
    if (!repoPath) return;
    const t = setInterval(() => {
      const p = repoPathRef.current;
      if (p) void loadAll(p, true);
    }, 5000);
    return () => clearInterval(t);
  }, [repoPath, loadAll]);

  // Load commit details when selection changes.
  const detailsReq = useRef(0);
  useEffect(() => {
    if (!repoPath || !selectedCommit) {
      setCommitDetails(null);
      return;
    }
    const req = ++detailsReq.current;
    const p = repoPath;
    const id = selectedCommit;
    api
      .getCommitDetails(p, id)
      .then((d) => {
        if (detailsReq.current === req) setCommitDetails(d);
      })
      .catch((e) => {
        if (detailsReq.current === req) setError(String(e));
      });
  }, [repoPath, selectedCommit, dataVersion]);

  /** Run a mutation then refresh everything. */
  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      const p = repoPathRef.current;
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

  const selectCommit = useCallback((id: string) => {
    setSelectedCommit(id);
    setBottomTab('commit');
  }, []);

  const openWorkdirDiff = useCallback((path: string, staged: boolean) => {
    setDiffTarget({ kind: 'workdir', path, staged });
    setBottomTab('diff');
  }, []);

  const openCommitDiff = useCallback((hash: string, path: string) => {
    setDiffTarget({ kind: 'commit', hash, path });
    setBottomTab('diff');
  }, []);

  /** Run a fetch/pull/push, surface git's output, then refresh. */
  const runRemote = useCallback(
    async (kind: 'fetch' | 'pull' | 'push', fn: () => Promise<string>) => {
      const p = repoPathRef.current;
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
      const p = repoPathRef.current;
      if (!p || !commitId) return;
      if (!log.some((c) => c.id === commitId)) {
        // Tagged commit may be older than the loaded window — fetch deeper.
        try {
          setLog(await api.getLog(p, 2000));
        } catch (e) {
          setError(String(e));
          return;
        }
      }
      setSelectedCommit(commitId);
      setBottomTab('commit');
      // Reset first so clicking the same tag twice still re-scrolls.
      setScrollToId(null);
      requestAnimationFrame(() => setScrollToId(commitId));
    },
    [log],
  );

  return (
    <div className="app">
      <Header
        repoInfo={repoInfo}
        loading={loading}
        remoteBusy={remoteBusy}
        onFetch={() => void runRemote('fetch', () => api.gitFetch(repoPath!))}
        onPull={() => void runRemote('pull', () => api.gitPull(repoPath!))}
        onPush={() => void runRemote('push', () => api.gitPush(repoPath!))}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenRepo={() => {
          setRepoPath(null);
          setRepoInfo(null);
          setSelectedCommit(null);
          setCommitDetails(null);
          setDiffTarget(null);
          setError(null);
        }}
        onRefresh={() => repoPath && loadAll(repoPath)}
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
      {!repoPath ? (
        <Welcome onOpen={openRepo} />
      ) : (
        <div className="main">
          <Sidebar
            tab={sidebarTab}
            onTabChange={setSidebarTab}
            status={status}
            branches={branches}
            tags={tags}
            repoPath={repoPath}
            isBare={repoInfo?.isBare ?? false}
            mutate={mutate}
            onSelectFile={openWorkdirDiff}
            onJumpToCommit={jumpToCommit}
          />
          <section className="center">
            <CommitList
              commits={log}
              selectedId={selectedCommit}
              scrollToId={scrollToId}
              onSelect={selectCommit}
            />
            <BottomPanel
              tab={bottomTab}
              onTabChange={setBottomTab}
              diffTarget={diffTarget}
              repoPath={repoPath}
              commitDetails={commitDetails}
              dataVersion={dataVersion}
              onOpenCommitDiff={openCommitDiff}
              onClearDiff={() => setDiffTarget(null)}
            />
          </section>
          <CommitBox
            repoPath={repoPath}
            isBare={repoInfo?.isBare ?? false}
            stagedCount={status.filter((f) => f.staged).length}
            mutate={mutate}
          />
        </div>
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
