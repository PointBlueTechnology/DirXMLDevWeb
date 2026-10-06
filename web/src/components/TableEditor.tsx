import { useEffect, useState } from "react";
import { parseMappingTable } from "../configxml";
import type { Pending } from "../pending";

/**
 * A mapping table as a grid. A row is identified by its first column, as the core's
 * `mapping-table.set-row` keys it: editing a cell rewrites that row, changing the key replaces
 * the row, and there are `delete-row` and `add-column` for the rest.
 */
export function TableEditor({ path, content, pending }: { path: string; content: string; pending: Pending }) {
  const table = parseMappingTable(content);
  const [rows, setRows] = useState<string[][]>([]);
  const [newColumn, setNewColumn] = useState("");

  useEffect(() => {
    if (pending.ops.length === 0) {
      setRows(table ? table.rows.map((r) => [...r]) : []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, pending.ops.length === 0]);

  if (!table) {
    return <div className="banner error">The source is not a &lt;mapping-table&gt;.</div>;
  }
  const cols = table.columns;
  if (cols.length === 0) {
    return <p className="muted pad">This table has no columns yet. Add one in the source.</p>;
  }

  const stageRow = (index: number, cells: string[]) => {
    const original = table.rows[index];
    const key = `row:${index}`;
    const same = original && original.join("\u0000") === cells.join("\u0000");
    pending.put(key + ":del", null);
    if (same || !(cells[0] ?? "").trim()) {
      pending.put(key, null);
      return;
    }
    if (original && original[0] !== cells[0]) {
      // the key changed: the old row goes, the new one is written
      pending.put(key + ":del", { name: "mapping-table.delete-row", args: { path, key: original[0] ?? "" }, label: `delete row ${original[0]}` });
    }
    pending.put(key, { name: "mapping-table.set-row", args: { path, col: cols.map((c, i) => `${c.name}=${cells[i] ?? ""}`).join("\n") }, label: `row ${cells[0]}: ${cols.slice(1).map((c, i) => `${c.name}=${cells[i + 1] ?? ""}`).join(", ")}` });
  };

  const edit = (index: number, col: number, value: string) => {
    const next = rows.map((r) => [...r]);
    next[index]![col] = value;
    setRows(next);
    stageRow(index, next[index]!);
  };

  const deleted = (index: number) => pending.has(`rowdel:${index}`);

  return (
    <div className="pad">
      <table className="defs grid">
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={c.name} title={`${c.type}${i === 0 ? " — the key column" : ""}`}>
                {c.name}
                {i === 0 ? " (key)" : ""}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={deleted(i) ? "removed" : pending.has(`row:${i}`) ? "changed" : ""}>
              {cols.map((c, j) => (
                <td key={c.name} className="vcell">
                  <input value={r[j] ?? ""} disabled={deleted(i)} onChange={(e) => edit(i, j, e.target.value)} spellCheck={false} />
                </td>
              ))}
              <td>
                {i < table.rows.length ? (
                  <button
                    className="mini danger"
                    title="Delete this row"
                    onClick={() => {
                      pending.put(`row:${i}`, null);
                      pending.put(`row:${i}:del`, null);
                      pending.put(`rowdel:${i}`, deleted(i) ? null : { name: "mapping-table.delete-row", args: { path, key: table.rows[i]![0] ?? "" }, label: `delete row ${table.rows[i]![0]}` });
                    }}
                  >
                    {deleted(i) ? "keep" : "×"}
                  </button>
                ) : (
                  <button
                    className="mini"
                    onClick={() => {
                      pending.put(`row:${i}`, null);
                      setRows(rows.filter((_, k) => k !== i));
                    }}
                  >
                    undo
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="addrow">
        <button onClick={() => setRows([...rows, cols.map(() => "")])}>Add row</button>
        <span className="muted small">A new row is staged once its key cell has a value.</span>
        <span className="spacer" />
        <input placeholder="new column name" value={newColumn} onChange={(e) => setNewColumn(e.target.value)} />
        <button
          disabled={!newColumn.trim() || cols.some((c) => c.name === newColumn.trim())}
          onClick={() => {
            pending.put(`col:${newColumn.trim()}`, { name: "mapping-table.add-column", args: { path, column: newColumn.trim() }, label: `add column ${newColumn.trim()}` });
            setNewColumn("");
          }}
        >
          Add column
        </button>
      </div>
      {pending.ops
        .filter((o) => o.key?.startsWith("col:"))
        .map((o) => (
          <p key={o.key} className="changed-line">
            + {o.label} (it appears after applying){" "}
            <button className="mini" onClick={() => o.key && pending.put(o.key, null)}>
              undo
            </button>
          </p>
        ))}
    </div>
  );
}
