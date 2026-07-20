// Renders the {index, index_name, columns, data} table shape returned by the
// backend's `_table()` helper (a JSON-friendly pandas DataFrame). Reusable by
// any future R&D strategy that needs to show raw or transformed tabular data.
export default function Table({ table, maxRows = 15, numberFmt }) {
  if (!table || !table.columns) return null;
  const rows = table.index.map((idx, i) => [idx, ...table.data[i]]);
  const shown = rows.slice(0, maxRows);
  const fmt = numberFmt || ((v) => (v == null ? "—" : typeof v === "number" ? v.toFixed(4) : String(v)));
  return (
    <div className="rd-table-wrap">
      <table className="rd-table">
        <thead>
          <tr>
            <th>{table.index_name || "index"}</th>
            {table.columns.map((c) => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i}>
              {row.map((v, j) => <td key={j}>{j === 0 ? String(v) : fmt(v)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p className="hint">showing {shown.length} of {rows.length} rows</p>
      )}
    </div>
  );
}

// Renders an array of plain records (list of dicts), used for the raw OHLCV
// preview which the backend returns record-style rather than as a table.
export function RecordsTable({ records, maxRows = 15 }) {
  if (!records || !records.length) return null;
  const columns = Object.keys(records[0]);
  const shown = records.slice(0, maxRows);
  return (
    <div className="rd-table-wrap">
      <table className="rd-table">
        <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c}>{String(r[c] ?? "—")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
