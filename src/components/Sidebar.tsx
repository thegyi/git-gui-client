import { BranchInfo, FileStatus, TagInfo } from '../api';
import ChangesPanel from './ChangesPanel';
import BranchesPanel from './BranchesPanel';
import TagsPanel from './TagsPanel';

export type Mutate = (fn: () => Promise<unknown>) => Promise<void>;

export type SidebarTab = 'changes' | 'branches' | 'tags';

interface Props {
  tab: SidebarTab;
  onTabChange: (t: SidebarTab) => void;
  status: FileStatus[];
  branches: BranchInfo[];
  tags: TagInfo[];
  repoPath: string;
  isBare: boolean;
  mutate: Mutate;
  onSelectFile: (path: string, staged: boolean) => void;
  onJumpToCommit: (commitId: string) => void;
}

export default function Sidebar(props: Props) {
  const { tab, onTabChange, status, branches, tags } = props;
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
      </div>
      <div className="sidebar-body">
        {tab === 'changes' && <ChangesPanel {...props} />}
        {tab === 'branches' && <BranchesPanel {...props} />}
        {tab === 'tags' && <TagsPanel {...props} />}
      </div>
    </aside>
  );
}
