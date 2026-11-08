import { BisectState, BranchInfo, FileStatus, ReflogEntry, RemoteInfo, StashInfo, TagInfo, WorktreeInfo } from '../api';
import BranchesPanel from './BranchesPanel';
import TagsPanel from './TagsPanel';
import StashesPanel from './StashesPanel';
import WorktreesPanel from './WorktreesPanel';
import RecoveryPanel from './RecoveryPanel';
import BisectPanel from './BisectPanel';
import SubmodulesPanel from './SubmodulesPanel';

export type Mutate = (fn: () => Promise<unknown>) => Promise<boolean>;

export type SidebarTab = 'branches' | 'tags' | 'stash' | 'worktrees' | 'recovery' | 'bisect' | 'submodules';

interface Props {
  tab: SidebarTab;
  onTabChange: (t: SidebarTab) => void;
  status: FileStatus[];
  branches: BranchInfo[];
  worktrees: WorktreeInfo[];
  reflog: ReflogEntry[];
  bisectState: BisectState;
  remotes: RemoteInfo[];
  tags: TagInfo[];
  stashes: StashInfo[];
  selectedCommit: string | null;
  selectedRemote: string;
  remoteBusy: string | null;
  repoPath: string;
  isBare: boolean;
  repoState: string;
  mutate: Mutate;
  onSelectFile: (path: string, staged: boolean, untracked: boolean) => void;
  onResolveConflictManually: (
    repoPath: string,
    file: string,
    content: string,
  ) => Promise<boolean>;
  onJumpToCommit: (commitId: string) => void;
  onPushTags: () => Promise<boolean>;
  onOpenWorktree: (path: string) => void;
}

export default function Sidebar(props: Props) {
  const { tab, onTabChange, branches, tags, stashes, worktrees, reflog } = props;

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button
          className={`tab ${tab === 'branches' ? 'active' : ''}`}
          onClick={() => onTabChange('branches')}
        >
          Branches
        </button>
        <button
          className={`tab ${tab === 'tags' ? 'active' : ''}`}
          onClick={() => onTabChange('tags')}
        >
          Tags {tags.length > 0 && <span className="count">{tags.length}</span>}
        </button>
        <button
          className={`tab ${tab === 'stash' ? 'active' : ''}`}
          onClick={() => onTabChange('stash')}
        >
          Stash {stashes.length > 0 && <span className="count">{stashes.length}</span>}
        </button>
        <button
          className={`tab ${tab === 'worktrees' ? 'active' : ''}`}
          onClick={() => onTabChange('worktrees')}
        >
          Worktrees {worktrees.length > 1 && <span className="count">{worktrees.length}</span>}
        </button>
        <button
          className={`tab ${tab === 'recovery' ? 'active' : ''}`}
          onClick={() => onTabChange('recovery')}
        >
          Recovery
        </button>
        <button
          className={`tab ${tab === 'bisect' ? 'active' : ''}`}
          onClick={() => onTabChange('bisect')}
        >
          Bisect
        </button>
        <button
          className={`tab ${tab === 'submodules' ? 'active' : ''}`}
          onClick={() => onTabChange('submodules')}
        >
          Submodules
        </button>
      </div>
      <div className="sidebar-body">
        {tab === 'branches' && <BranchesPanel {...props} />}
        {tab === 'tags' && <TagsPanel {...props} />}
        {tab === 'stash' && <StashesPanel {...props} />}
        {tab === 'worktrees' && <WorktreesPanel
          branches={branches}
          worktrees={worktrees}
          repoPath={props.repoPath}
          isBare={props.isBare}
          mutate={props.mutate}
          onOpen={props.onOpenWorktree}
        />}
        {tab === 'recovery' && <RecoveryPanel
          entries={reflog}
          repoPath={props.repoPath}
          mutate={props.mutate}
        />}
        {tab === 'bisect' && <BisectPanel
          state={props.bisectState}
          selectedCommit={props.selectedCommit}
          repoPath={props.repoPath}
          repoState={props.repoState}
          mutate={props.mutate}
          onJumpToCommit={props.onJumpToCommit}
        />}
        {tab === 'submodules' && <SubmodulesPanel
          repoPath={props.repoPath}
          isBare={props.isBare}
          mutate={props.mutate}
        />}
      </div>
    </aside>
  );
}
