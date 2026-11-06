interface TabInfo {
  path: string;
  name: string;
}

interface Props {
  tabs: TabInfo[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onNew: () => void;
}

export default function TabBar({ tabs, activePath, onSelect, onClose, onNew }: Props) {
  if (tabs.length === 0) return null;
  return (
    <div className="tab-bar">
      {tabs.map((t) => (
        <div
          key={t.path}
          className={`repo-tab ${t.path === activePath ? 'active' : ''}`}
          onClick={() => onSelect(t.path)}
          title={t.path}
        >
          <span className="repo-tab-name">{t.name}</span>
          <button
            className="tab-close"
            title="Close repository"
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.path);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="repo-tab-new" title="Open repository" onClick={onNew}>
        +
      </button>
    </div>
  );
}
