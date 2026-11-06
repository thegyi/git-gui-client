import { useEffect, useMemo } from 'react';
import { CommitInfo } from '../api';

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
  onSelect: (id: string) => void;
}

export default function CommitList({ commits, selectedId, scrollToId, onSelect }: Props) {
  const graph = useMemo(() => computeGraph(commits), [commits]);

  useEffect(() => {
    if (!scrollToId) return;
    const el = document.querySelector(`[data-commit-id="${scrollToId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [scrollToId, commits]);

  // Per-row vertical lanes.
  const rowVLines = useMemo(() => {
    const rows: Set<number>[] = commits.map(() => new Set<number>());
    for (const e of graph.edges) {
      for (let r = e.top; r <= Math.min(e.bottom, commits.length - 1); r++) {
        rows[r].add(e.lane);
      }
    }
    return rows;
  }, [graph, commits.length]);

  if (commits.length === 0) {
    return <div className="panel-empty commit-list-empty">No commits yet.</div>;
  }

  return (
    <div className="commit-list">
      <div className="commit-header">
        <div style={{ width: graph.width }} />
        <span className="ch-hash">Hash</span>
        <span className="ch-msg">Message</span>
        <span className="ch-author">Author</span>
        <span className="ch-date">Date</span>
      </div>
      {commits.map((c, i) => {
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
          </div>
        );
      })}
    </div>
  );
}
