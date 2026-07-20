import { useState } from "react";

export default function SessionTabs({
  sessions, activeId, onSwitch, onAdd, onRename, onDelete, onArchive, onRestore,
}) {
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const visible = sessions.filter((s) => !s.archived);
  const archived = sessions.filter((s) => s.archived);

  return (
    <div className="session-tabs-wrap">
      <div className="session-tabs">
        {visible.map((s) => (
          <div key={s.id} className={"stab" + (s.id === activeId ? " active" : "")}>
            {editing === s.id ? (
              <input
                className="stab-input"
                autoFocus
                defaultValue={s.name}
                onBlur={(e) => { onRename(s.id, e.target.value.trim() || s.name); setEditing(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <>
                <button className="stab-name" onClick={() => onSwitch(s.id)}
                  onDoubleClick={() => setEditing(s.id)} title="Double-click to rename">
                  {s.name}
                </button>
                <button className="stab-archive" title="Archive tab (hide, keep its data)"
                  onClick={() => onArchive(s.id)}>⤓</button>
                {sessions.length > 1 && (
                  <button className="stab-x" title="Delete tab permanently"
                    onClick={() => { if (confirm(`Permanently delete "${s.name}" and its cells? This cannot be undone.`)) onDelete(s.id); }}>×</button>
                )}
              </>
            )}
          </div>
        ))}
        <button className="stab-add" title="New tab" onClick={onAdd}>+ tab</button>
        {archived.length > 0 && (
          <button className="stab-archived-toggle" onClick={() => setShowArchived((v) => !v)}>
            Archived ({archived.length}) {showArchived ? "▲" : "▼"}
          </button>
        )}
      </div>

      {showArchived && archived.length > 0 && (
        <div className="archived-tray">
          {archived.map((s) => (
            <div key={s.id} className="archived-chip">
              <span>{s.name}</span>
              <button className="ghost" title="Restore tab" onClick={() => onRestore(s.id)}>Restore</button>
              <button className="stab-x" title="Delete permanently"
                onClick={() => { if (confirm(`Permanently delete "${s.name}" and its cells? This cannot be undone.`)) onDelete(s.id); }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
