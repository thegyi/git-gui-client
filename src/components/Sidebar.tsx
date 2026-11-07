import { BranchInfo, FileStatus, RemoteInfo, StashInfo, TagInfo } from '../api';
import ChangesPanel from './ChangesPanel';
import BranchesPanel from './BranchesPanel';
import TagsPanel from './TagsPanel';
import StashesPanel from './StashesPanel';

export type Mutate = (fn: () => Promise<unknown>) => Promise<boolean>;

export type SidebarTab = 'changes' | 'branches' | 'tags' | 'stash';

interface Props {
  tab: SidebarTab;
  onTabChange: (t: SidebarTab) => void;
  status: FileStatus[];
  branches: BranchInfo[];
  remotes: RemoteInfo[];
  tags: TagInfo[];
  stashes: StashInfo[];
  selectedCommit: string | null;
  repoPath: string;
  isBare: boolean;
  repoState: string;
  mutate: Mutate;
  onSelectFile: (path: string, staged: boolean) => void;
  onResolveConflictManually: (
    repoPath: string,
    file: string,
    content: string,
  ) => Promise<boolean>;
  onJumpToCommit: (commitId: string) => void;
}

export default function Sidebar(props: Props) {
  const { tab, onTabChange, status, branches, tags, stashes } = props;
  const changedCount = status.filter((f) => f.staged || f.unstaged || f.untracked).length;

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button
          className={`tab ${tab === 'changes' ? 'active' : ''}`}
          onClick={() => onTabChange('changes')}
        >
          Changes {changedCount > 0 && <span className="count">{changedCount}</span>}
        </button>
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
      </div>
      <div className="sidebar-body">
        {tab === 'changes' && <ChangesPanel {...props} />}
        {tab === 'branches' && <BranchesPanel {...props} />}
        {tab === 'tags' && <TagsPanel {...props} />}
        {tab === 'stash' && <StashesPanel {...props} />}
      </div>
    </aside>
  );
}
