export default function Memory({ notes, onNotes, savedAt }) {
  return (
    <div className="panel notes">
      <div className="panel-head">
        <h2>Memory — notes for this project</h2>
        <div className="spacer" />
        <span className="hint" style={{ marginTop: 0 }}>
          {savedAt ? "Saved" : "Autosaves"}
        </span>
      </div>
      <div className="panel-body">
        <textarea
          value={notes}
          placeholder="What you learned, questions, TODOs… saved automatically and restored next time."
          onChange={(e) => onNotes(e.target.value)}
        />
        <p className="hint">Notes, chat, and notebook cells persist across sessions.</p>
      </div>
    </div>
  );
}
