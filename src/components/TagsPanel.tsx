import { useEffect, useState } from 'react';
import { api, TagInfo } from '../api';
import { Mutate } from './Sidebar';

interface Props {
  tags: TagInfo[];
  selectedCommit: string | null;
  selectedRemote: string;
  remoteBusy: string | null;
  repoPath: string;
  mutate: Mutate;
  onJumpToCommit: (commitId: string) => void;
  onPushTags: () => Promise<boolean>;
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
  selectedRemote,
  remoteBusy,
  repoPath,
  mutate,
  onJumpToCommit,
  onPushTags,
}: Props) {
  const [name, setName] = useState('');
  const [remoteTagNames, setRemoteTagNames] = useState<Set<string> | null>(null);
  const [remoteTagsLoading, setRemoteTagsLoading] = useState(false);
  const [remoteTagsError, setRemoteTagsError] = useState<string | null>(null);
  const [remoteTagsReload, setRemoteTagsReload] = useState(0);
  const busy = remoteBusy !== null;

  useEffect(() => {
    if (!selectedRemote) {
      setRemoteTagNames(null);
      setRemoteTagsLoading(false);
      setRemoteTagsError(null);
      return;
    }

    let current = true;
    setRemoteTagNames(null);
    setRemoteTagsLoading(true);
    setRemoteTagsError(null);
    void api.getRemoteTags(repoPath, selectedRemote)
      .then((names) => {
        if (current) setRemoteTagNames(new Set(names));
      })
      .catch((error: unknown) => {
        if (current) setRemoteTagsError(String(error));
      })
      .finally(() => {
        if (current) setRemoteTagsLoading(false);
      });

    return () => {
      current = false;
    };
  }, [repoPath, selectedRemote, remoteTagsReload]);

  const create = () => {
    const n = name.trim();
    if (!n) return;
    void mutate(() => api.createTag(repoPath, n, selectedCommit ?? undefined)).then((success) => {
      if (success) setName('');
    });
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
        <button
          className="btn"
          disabled={busy || !selectedRemote}
          title={selectedRemote ? `Push all tags to ${selectedRemote}` : 'Add a remote to push tags'}
          onClick={() => {
            if (
              window.confirm(
                `Push all local tags to ${selectedRemote}? Tags already present on the remote will not be overwritten.`,
              )
            ) {
              void onPushTags().then((success) => {
                if (success) setRemoteTagsReload((reload) => reload + 1);
              });
            }
          }}
        >
          {remoteBusy === 'push-tags' ? '…' : 'Push tags'}
        </button>
      </div>
      <div className="panel-empty" title={selectedCommit ?? undefined}>
        Tag target:{' '}
        {selectedCommit
          ? `selected commit ${selectedCommit.slice(0, 7)}`
          : 'current commit (HEAD); select a history commit to change'}
      </div>
      {remoteTagsError && (
        <div className="panel-empty" role="status">
          Could not check tags on {selectedRemote}: {remoteTagsError}
        </div>
      )}
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
            <span
              className={`tag-remote tag-presence ${
                remoteTagsLoading || !selectedRemote
                  ? 'unknown'
                  : remoteTagNames?.has(t.name)
                    ? 'present'
                    : remoteTagNames
                      ? 'local-only'
                      : 'unknown'
              }`}
              title={
                !selectedRemote
                  ? 'Select a remote to check whether this tag exists there'
                  : remoteTagsLoading
                    ? `Checking tag on ${selectedRemote}`
                    : remoteTagsError
                      ? `Could not check tag on ${selectedRemote}`
                      : remoteTagNames?.has(t.name)
                        ? `Tag exists on ${selectedRemote}`
                        : 'Tag exists only locally'
              }
            >
              {!selectedRemote
                ? 'unknown'
                : remoteTagsLoading
                  ? 'checking'
                  : remoteTagsError
                    ? 'unknown'
                    : remoteTagNames?.has(t.name)
                      ? `on ${selectedRemote}`
                      : 'local only'}
            </span>
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
