import { api, BisectState } from '../api';
import { Mutate } from './Sidebar';

interface Props {
  state: BisectState;
  selectedCommit: string | null;
  repoPath: string;
  repoState: string;
  mutate: Mutate;
  onJumpToCommit: (commitId: string) => void;
}

export default function BisectPanel({
  state,
  selectedCommit,
  repoPath,
  repoState,
  mutate,
  onJumpToCommit,
}: Props) {
  const canStart = Boolean(selectedCommit) && repoState === 'clean';

  return (
    <div className="bisect-panel">
      <div className="group-header">Find a regression with bisect</div>
      {state.active ? (
        <>
          <p className="hint">
            Test the checked-out candidate. Mark it good if the bug is absent, or bad if it is present.
          </p>
          {state.currentCommit ? (
            <button
              className="bisect-candidate"
              onClick={() => onJumpToCommit(state.currentCommit!)}
            >
              <code>{state.shortId}</code>
              <span>{state.subject || 'Current candidate'}</span>
            </button>
          ) : (
            <div className="panel-empty">Bisect is active, but no candidate commit was reported.</div>
          )}
          <div className="bisect-actions">
            <button
              className="btn"
              disabled={!state.currentCommit || repoState !== 'bisect'}
              onClick={() => void mutate(() => api.bisectMark(repoPath, true))}
            >
              Mark good
            </button>
            <button
              className="btn danger"
              disabled={!state.currentCommit || repoState !== 'bisect'}
              onClick={() => void mutate(() => api.bisectMark(repoPath, false))}
            >
              Mark bad
            </button>
            <button
              className="mini-btn"
              onClick={() => {
                if (window.confirm('Stop bisect and return to the original branch?')) {
                  void mutate(() => api.bisectReset(repoPath));
                }
              }}
            >
              Reset
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            Select a known-good commit in history. The current HEAD will be treated as known bad.
            Commit or stash working-tree changes first.
          </p>
          {selectedCommit && (
            <div className="bisect-good-commit">
              Known good: <code>{selectedCommit.slice(0, 7)}</code>
            </div>
          )}
          <button
            className="btn"
            disabled={!canStart}
            onClick={() => {
              if (
                selectedCommit &&
                window.confirm(
                  `Start bisect with HEAD as bad and ${selectedCommit.slice(0, 7)} as good?`,
                )
              ) {
                void mutate(() => api.bisectStart(repoPath, selectedCommit));
              }
            }}
          >
            Start bisect
          </button>
          {!selectedCommit && <div className="panel-empty">Select a commit in history first.</div>}
          {selectedCommit && repoState !== 'clean' && (
            <div className="panel-empty">Resolve the current Git operation before starting bisect.</div>
          )}
        </>
      )}
    </div>
  );
}
