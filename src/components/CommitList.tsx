import { useEffect, useMemo, useState } from 'react';
import { CommitInfo, ResetMode } from '../api';

const LANE_W = 16;
const NODE = 10;
const LANE_COLORS = [
  '#f2b04e',
  '#58a6ff',
  '#56d186',
  '#bc8cff',
  '#ff7b72',
  '#79c0ff',
  '#ffa657',
  '#d2a8ff',
  '#7ee787',
  '#ffa198',
];

interface Edge {
  lane: number;
  top: number;
  bottom: number;
}

interface Graph {
  edges: Edge[];
  commitLane: number[];
  inLanes: number[][];
  outLanes: number[][];
  width: number;
}

/** Assign graph lanes to commits (children always appear above parents). */
function computeGraph(commits: CommitInfo[]): Graph {
  const idToRow = new Map(commits.map((c, i) => [c.id, i]));
  const n = commits.length;
  const commitLane = new Array<number>(n).fill(-1);
  const inLanes: number[][] = Array.from({ length: n }, () => []);
  const outLanes: number[][] = Array.from({ length: n }, () => []);
  const edges: Edge[] = [];
  let pending: { lane: number; targetId: string; topRow: number }[] = [];
  const reserved = new Set<number>();

  const freeLane = () => {
    let l = 0;
    while (reserved.has(l)) l++;
    return l;
  };

  for (let i = 0; i < n; i++) {
    const c = commits[i];
    const incoming = pending.filter((e) => e.targetId === c.id);
    pending = pending.filter((e) => e.targetId !== c.id);
    for (const e of incoming) {
      edges.push({ lane: e.lane, top: e.topRow, bottom: i });
    }
    for (const e of incoming.slice(1)) reserved.delete(e.lane);

    let lane: number;
    if (incoming.length > 0) {
      lane = incoming[0].lane;
    } else {
      lane = freeLane();
      reserved.add(lane);
    }
    commitLane[i] = lane;
    inLanes[i] = incoming.map((e) => e.lane);

    const parentRows = c.parents
      .map((p) => idToRow.get(p))
      .filter((r): r is number => r !== undefined && r > i)
      .sort((a, b) => a - b);

    if (parentRows.length === 0) {
      reserved.delete(lane);
      continue;
    }

    const [p1, ...rest] = parentRows;
    pending.push({ lane, targetId: commits[p1].id, topRow: i });
    for (const pr of rest) {
      const l2 = freeLane();
      reserved.add(l2);
      pending.push({ lane: l2, targetId: commits[pr].id, topRow: i });
      outLanes[i].push(l2);
    }
  }
  for (const e of pending) {
    edges.push({ lane: e.lane, top: e.topRow, bottom: n });
  }

  let maxLane = 0;
  for (const l of commitLane) maxLane = Math.max(maxLane, l);
  for (const e of edges) maxLane = Math.max(maxLane, e.lane);
  return { edges, commitLane, inLanes, outLanes, width: (maxLane + 1) * LANE_W };
}

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

function center(lane: number): number {
  return lane * LANE_W + LANE_W / 2;
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(ts * 1000).toLocaleDateString();
}

function subject(message: string): string {
  return message.split('\n')[0];
}

interface Props {
  commits: CommitInfo[];
  selectedId: string | null;
  scrollToId?: string | null;
  actionsDisabled?: boolean;
  hasMoreHistory: boolean;
  loadingOlderHistory: boolean;
  onSelect: (id: string) => void;
  onLoadOlder: () => void;
  onCherryPick: (id: string) => void;
  onRevert: (id: string) => void;
  onReset: (id: string, mode: ResetMode) => void;
}

export default function CommitList({
  commits,
  selectedId,
  scrollToId,
  actionsDisabled = false,
  hasMoreHistory,
  loadingOlderHistory,
  onSelect,
  onLoadOlder,
  onCherryPick,
  onRevert,
  onReset,
}: Props) {
  const [filter, setFilter] = useState('');
  const [resetCommit, setResetCommit] = useState<CommitInfo | null>(null);
  const [resetMode, setResetMode] = useState<ResetMode>('mixed');

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return commits;
    return commits.filter(
      (c) =>
        c.message.toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q) ||
        c.authorEmail.toLowerCase().includes(q) ||
        c.shortId.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  }, [commits, filter]);

  const graph = useMemo(() => computeGraph(visible), [visible]);

  useEffect(() => {
    if (!scrollToId) return;
    const el = document.querySelector(`[data-commit-id="${scrollToId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [scrollToId, commits]);

  // Per-row vertical lanes.
  const rowVLines = useMemo(() => {
    const rows: Set<number>[] = visible.map(() => new Set<number>());
    for (const e of graph.edges) {
      for (let r = e.top; r <= Math.min(e.bottom, visible.length - 1); r++) {
        rows[r].add(e.lane);
      }
    }
    return rows;
  }, [graph, visible.length]);

  if (commits.length === 0) {
    return <div className="panel-empty commit-list-empty">No commits yet.</div>;
  }

  return (
    <div className="commit-list">
      <div className="commit-filter">
        <input
          className="input"
          placeholder="Filter commits (message, author, hash)…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter.trim() && (
          <span className="filter-count">
            {visible.length}/{commits.length}
          </span>
        )}
      </div>
      <div className="commit-header">
        <div style={{ width: graph.width }} />
        <span className="ch-hash">Hash</span>
        <span className="ch-msg">Message</span>
        <span className="ch-author">Author</span>
        <span className="ch-date">Date</span>
      </div>
      {visible.length === 0 && (
        <div className="panel-empty">No commits match the filter.</div>
      )}
      {visible.map((c, i) => {
        const lane = graph.commitLane[i];
        const involved = Array.from(
          new Set([lane, ...graph.inLanes[i], ...graph.outLanes[i]]),
        ).sort((a, b) => a - b);
        const isHead = c.refs.some((r) => r.kind === 'head');
        const badges = c.refs.filter((r) => r.kind !== 'head').slice(0, 3);
        const extraRefs = c.refs.filter((r) => r.kind !== 'head').length - badges.length;
        const vlines = Array.from(rowVLines[i]);

        return (
          <div
            key={c.id}
            data-commit-id={c.id}
            className={`commit-row ${selectedId === c.id ? 'selected' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <div className="graph" style={{ width: graph.width }}>
              {vlines.map((l) => (
                <div
                  key={`v${l}`}
                  className="vline"
                  style={{ left: center(l) - 1, background: laneColor(l) }}
                />
              ))}
              {involved.length > 1 && (
                <div
                  className="hline"
                  style={{
                    left: center(involved[0]),
                    width: center(involved[involved.length - 1]) - center(involved[0]),
                    background: laneColor(lane),
                  }}
                />
              )}
              <div
                className={`node ${isHead ? 'head' : ''} ${c.parents.length > 1 ? 'merge' : ''}`}
                style={{
                  left: center(lane) - NODE / 2,
                  background: laneColor(lane),
                }}
                title={isHead ? 'HEAD' : undefined}
              />
            </div>
            <span className="c-hash" title={c.id}>
              {c.shortId}
            </span>
            <span className="c-msg" title={c.message}>
              {subject(c.message)}
              {c.message.includes('\n') && <span className="body-hint"> ⏎</span>}
              {badges.map((r) => (
                <span
                  key={`${r.kind}:${r.name}`}
                  className={`ref-badge ${r.kind === 'tag' ? 'tag' : r.kind === 'remote' ? 'remote' : 'branch'}`}
                >
                  {r.name}
                </span>
              ))}
              {extraRefs > 0 && <span className="ref-badge more">+{extraRefs}</span>}
            </span>
            <span className="c-author">{c.authorName}</span>
            <span className="c-date" title={new Date(c.time * 1000).toLocaleString()}>
              {timeAgo(c.time)}
            </span>
            {selectedId === c.id && (
              <span className="commit-actions">
                <button
                  className="mini-btn"
                  title={`Cherry-pick ${c.shortId}`}
                  disabled={actionsDisabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Cherry-pick commit ${c.shortId}?`)) onCherryPick(c.id);
                  }}
                >
                  Cherry-pick
                </button>
                <button
                  className="mini-btn danger"
                  title={`Revert ${c.shortId}`}
                  disabled={actionsDisabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      window.confirm(
                        `Create a new commit that reverts ${c.shortId} (${subject(c.message)})?`,
                      )
                    ) {
                      onRevert(c.id);
                    }
                  }}
                >
                  Revert
                </button>
                <button
                  className="mini-btn danger"
                  title={`Reset current branch to ${c.shortId}`}
                  disabled={actionsDisabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    setResetCommit(c);
                    setResetMode('mixed');
                  }}
                >
                  Reset
                </button>
              </span>
            )}
          </div>
        );
      })}
      {hasMoreHistory && (
        <div className="history-load-more">
          <button
            className="btn"
            disabled={loadingOlderHistory}
            onClick={onLoadOlder}
          >
            {loadingOlderHistory ? 'Loading older commits…' : 'Load older history'}
          </button>
        </div>
      )}
      {resetCommit && (
        <div className="modal-overlay" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setResetCommit(null);
        }}>
          <section
            className="modal-card reset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-dialog-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="reset-dialog-title">Reset current branch</h2>
            <p>
              Move the current branch to <code>{resetCommit.shortId}</code> —{' '}
              {subject(resetCommit.message)}
            </p>
            <label className="field">
              Reset mode
              <select
                className="input"
                value={resetMode}
                onChange={(e) => {
                  const mode = e.currentTarget.value;
                  if (mode === 'soft' || mode === 'mixed' || mode === 'hard') {
                    setResetMode(mode);
                  }
                }}
              >
                <option value="soft">Soft — keep changes staged</option>
                <option value="mixed">Mixed — keep changes, unstage them</option>
                <option value="hard">Hard — discard staged and tracked changes</option>
              </select>
            </label>
            <p className={resetMode === 'hard' ? 'reset-warning' : 'hint'}>
              {resetMode === 'soft'
                ? 'The branch moves; the index and working tree remain unchanged.'
                : resetMode === 'mixed'
                  ? 'The branch and index move; working-tree files remain unchanged.'
                  : 'This permanently discards staged and tracked working-tree changes.'}
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setResetCommit(null)}>
                Cancel
              </button>
              <button
                className={`btn ${resetMode === 'hard' ? 'danger' : 'primary'}`}
                onClick={() => {
                  if (
                    resetMode === 'hard' &&
                    !window.confirm(
                      `Hard reset to ${resetCommit.shortId}? Staged and tracked working-tree changes will be discarded.`,
                    )
                  ) {
                    return;
                  }
                  const { id } = resetCommit;
                  setResetCommit(null);
                  onReset(id, resetMode);
                }}
              >
                Reset to commit
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
