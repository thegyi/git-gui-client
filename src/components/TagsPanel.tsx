import { useState } from 'react';
import { api, TagInfo } from '../api';
import { Mutate } from './Sidebar';

interface Props {
  tags: TagInfo[];
  selectedCommit: string | null;
  repoPath: string;
  mutate: Mutate;
  onJumpToCommit: (commitId: string) => void;
}

function timeAgo(ts: number): string {
  if (!ts) return '';
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export default function TagsPanel({
  tags,
  selectedCommit,
  repoPath,
  mutate,
  onJumpToCommit,
}: Props) {
  const [name, setName] = useState('');

  const create = () => {
    const n = name.trim();
    if (!n) return;
    void mutate(() => api.createTag(repoPath, n, selectedCommit ?? undefined)).then(() => setName(''));
  };

  return (
    <div className="tags-panel">
      <div className="branch-create">
        <input
          className="input"
          placeholder="New tag name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button className="btn" disabled={!name.trim()} onClick={create}>
          Create
        </button>
      </div>
      <div className="panel-empty" title={selectedCommit ?? undefined}>
        Tag target:{' '}
        {selectedCommit
          ? `selected commit ${selectedCommit.slice(0, 7)}`
          : 'current commit (HEAD); select a history commit to change'}
      </div>
      {tags.length === 0 && <div className="panel-empty">No tags.</div>}
      {tags.map((t: TagInfo) => (
        <div
          key={t.name}
          className="branch-row tag-row"
          onClick={() => t.targetId && onJumpToCommit(t.targetId)}
          title={t.message || t.name}
        >
          <span className="branch-name">
            <span className="tag-icon">{t.isAnnotated ? '◈' : '○'}</span> {t.name}
          </span>
          <span className="branch-meta">{timeAgo(t.time)}</span>
          <span className="file-actions">
            <button
              className="mini-btn danger"
              title="Delete tag"
              aria-label={`Delete tag ${t.name}`}
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete tag "${t.name}"?`)) {
                  void mutate(() => api.deleteTag(repoPath, t.name));
                }
              }}
            >
              ×
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
