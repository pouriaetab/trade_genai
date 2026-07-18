import { useState } from "react";

export default function SessionTabs({ sessions, activeId, onSwitch, onAdd, onRename, onDelete }) {
  const [editing, setEditing] = useState(null);

  return (
    <div className="session-tabs">
      {sessions.map((s) => (
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
              {sessions.length > 1 && (
                <button className="stab-x" title="Delete tab"
                  onClick={() => { if (confirm(`Delete "${s.name}" and its cells?`)) onDelete(s.id); }}>×</button>
              )}
            </>
          )}
        </div>
      ))}
      <button className="stab-add" title="New tab" onClick={onAdd}>+ tab</button>
    </div>
  );
}
