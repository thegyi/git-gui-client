import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
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
  onDeleteTag: (name: string) => Promise<boolean>;
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
  onDeleteTag,
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

  const renderTag = (tagName: string, localTag?: TagInfo) => {
    const remoteHasTag = remoteTagNames?.has(tagName) ?? false;
    const presence = remoteTagsLoading || !selectedRemote || remoteTagsError
      ? 'unknown'
      : remoteHasTag || !localTag
        ? 'present'
        : 'local-only';
    const presenceTitle = !selectedRemote
      ? 'Select a remote to check whether this tag exists there'
      : remoteTagsLoading
        ? `Checking tag on ${selectedRemote}`
        : remoteTagsError
          ? `Could not check tag on ${selectedRemote}`
          : !localTag
            ? `Tag exists only on ${selectedRemote}`
            : remoteHasTag
              ? `Tag exists on ${selectedRemote}`
              : 'Tag exists only locally';

    return (
      <div
        key={tagName}
        className="branch-row tag-row"
        onClick={() => localTag?.targetId && onJumpToCommit(localTag.targetId)}
        title={localTag?.message || tagName}
      >
        <span className="branch-name">
          <span className="tag-icon">{localTag?.isAnnotated ? '◈' : '○'}</span> {tagName}
          <span className={`tag-remote tag-presence ${presence}`} title={presenceTitle}>
            {!selectedRemote
              ? 'unknown'
              : remoteTagsLoading
                ? 'checking'
                : remoteTagsError
                  ? 'unknown'
                  : !localTag
                    ? 'remote only'
                    : remoteHasTag
                      ? `on ${selectedRemote}`
                      : 'local only'}
          </span>
        </span>
        <span className="branch-meta">{timeAgo(localTag?.time ?? 0)}</span>
        <span className="file-actions always">
          <button
            className="mini-btn danger"
            title={selectedRemote ? `Delete tag from ${selectedRemote}` : 'Delete local tag'}
            aria-label={`Delete tag ${tagName}`}
            onClick={async (e) => {
              e.stopPropagation();
              const message = selectedRemote
                ? localTag
                  ? `Delete tag "${tagName}" locally and from ${selectedRemote}?`
                  : `Delete tag "${tagName}" from ${selectedRemote}?`
                : `Delete tag "${tagName}" locally?`;
              const confirmed = isTauri()
                ? await confirmDialog(message, {
                    title: 'Delete tag',
                    kind: 'warning',
                    okLabel: 'Delete',
                    cancelLabel: 'Cancel',
                  })
                : window.confirm(message);
              if (!confirmed) return;
              const success = await onDeleteTag(tagName);
              if (success) setRemoteTagsReload((reload) => reload + 1);
            }}
            disabled={busy}
          >
            {remoteBusy === 'delete-tag' ? '…' : '×'}
          </button>
        </span>
      </div>
    );
  };
  const localTagNames = new Set(tags.map((tag) => tag.name));
  const remoteOnlyTagNames = remoteTagNames
    ? [...remoteTagNames].filter((tagName) => !localTagNames.has(tagName)).sort()
    : [];

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
          onClick={async () => {
            const message = `Push all local tags to ${selectedRemote}? Tags already present on the remote will not be overwritten.`;
            const confirmed = isTauri()
              ? await confirmDialog(message, {
                  title: 'Push tags',
                  kind: 'warning',
                  okLabel: 'Push',
                  cancelLabel: 'Cancel',
                })
              : window.confirm(message);
            if (!confirmed) return;
            const success = await onPushTags();
            if (success) setRemoteTagsReload((reload) => reload + 1);
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
      {tags.length === 0 && remoteOnlyTagNames.length === 0 && (
        <div className="panel-empty">No tags.</div>
      )}
      {tags.map((tag) => renderTag(tag.name, tag))}
      {remoteOnlyTagNames.map((tagName) => renderTag(tagName))}
    </div>
  );
}
