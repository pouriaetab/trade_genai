import { useState } from "react";

export default function Memory({ notes, onNotes, onSave }) {
  const [hint, setHint] = useState("Chat history and notes persist across restarts.");

  function save() {
    onSave();
    setHint("Saved.");
    setTimeout(() => setHint("Chat history and notes persist across restarts."), 1500);
  }

  return (
    <div className="panel notes">
      <div className="panel-head">
        <h2>Memory — notes for this project</h2>
        <div className="spacer" />
        <button className="ghost" onClick={save}>Save</button>
      </div>
      <div className="panel-body">
        <textarea
          value={notes}
          placeholder="What you learned, questions, TODOs… saved to data/ and reloaded next time."
          onChange={(e) => onNotes(e.target.value)}
        />
        <p className="hint">{hint}</p>
      </div>
    </div>
  );
}
