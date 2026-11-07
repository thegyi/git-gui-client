import type { BottomTab, DiffTarget } from '../App';
import { CommitDetails } from '../api';
import DiffView from './DiffView';
import CommitDetailsPanel from './CommitDetailsPanel';
import type { Mutate } from './Sidebar';

interface Props {
  tab: BottomTab;
  onTabChange: (t: BottomTab) => void;
  diffTarget: DiffTarget | null;
  repoPath: string;
  commitDetails: CommitDetails | null;
  dataVersion: number;
  onOpenCommitDiff: (hash: string, path: string) => void;
  onClearDiff: () => void;
  mutate: Mutate;
  onRebase?: (commitId: string) => void;
}

export default function BottomPanel({
  tab,
  onTabChange,
  diffTarget,
  repoPath,
  commitDetails,
  dataVersion,
  onOpenCommitDiff,
  onClearDiff,
  mutate,
  onRebase,
}: Props) {
  return (
    <div className="bottom-panel">
      <div className="bottom-tabs">
        <button
          className={`tab ${tab === 'diff' ? 'active' : ''}`}
          onClick={() => onTabChange('diff')}
        >
          Diff{diffTarget ? ' ●' : ''}
        </button>
        <button
          className={`tab ${tab === 'commit' ? 'active' : ''}`}
          onClick={() => onTabChange('commit')}
        >
          Commit
        </button>
        {diffTarget && (
          <button className="mini-btn close-btn" title="Clear diff" onClick={onClearDiff}>
            ×
          </button>
        )}
      </div>
      <div className="bottom-body">
        {tab === 'diff' ? (
          diffTarget ? (
            <DiffView
              key={`${diffTarget.kind}:${'path' in diffTarget ? diffTarget.path : ''}:${'staged' in diffTarget ? diffTarget.staged : ''}:${'hash' in diffTarget ? diffTarget.hash : ''}`}
              repoPath={repoPath}
              target={diffTarget}
              dataVersion={dataVersion}
              mutate={mutate}
            />
          ) : (
            <div className="panel-empty">
              Select a file in “Changes” or a file in a commit to view its diff.
            </div>
          )
        ) : (
          <CommitDetailsPanel
            details={commitDetails}
            onOpenFile={onOpenCommitDiff}
            onRebase={onRebase}
          />
        )}
      </div>
    </div>
  );
}
