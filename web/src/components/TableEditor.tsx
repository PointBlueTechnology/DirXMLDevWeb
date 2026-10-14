import { useEffect, useRef, useState } from "react";
import { parseMappingTable } from "../configxml";
import { tableCsv } from "../tablecsv";
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
  const [merge, setMerge] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

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
  const name = path.split("/").pop() ?? "table";
  // export: the table as saved (what is applied), header then rows, as mapping-table.export-csv writes it
  const exportCsv = () => {
    const blob = new Blob([tableCsv(cols.map((c) => c.name), table.rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  // import: staged like any other change; the review shows the table's new XML before anything is written
  const importCsv = (file: File) => {
    void file.text().then((text) =>
      pending.put("csv", {
        name: "mapping-table.import-csv",
        args: { path, ...(merge ? { merge: "true" } : {}) },
        files: { "csv-file": text },
        label: `${merge ? "merge" : "replace the table with"} ${file.name}`,
      }),
    );
  };
  const csvBar = (
    <div className="addrow" data-testid="table-csv">
      <button onClick={exportCsv} title="Download the table as saved, as CSV: a header of column names, then one line per row" data-testid="table-export">
        Export CSV
      </button>
      <button onClick={() => fileInput.current?.click()} title="Choose a CSV file: its first line names the columns, its first column is the key" data-testid="table-import">
        Import CSV…
      </button>
      <label className="checkchip" title="Off: the table becomes the CSV (its columns and rows). On: rows are added and updated by key, the others kept.">
        <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} data-testid="table-import-merge" /> merge by key
      </label>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            importCsv(f);
          }
          e.target.value = "";
        }}
        data-testid="table-import-file"
      />
      {pending.has("csv") && (
        <span className="changed-line">
          + {pending.ops.find((o) => o.key === "csv")?.label} (review to see the result){" "}
          <button className="mini" onClick={() => pending.put("csv", null)}>
            undo
          </button>
        </span>
      )}
    </div>
  );
  if (cols.length === 0) {
    return (
      <div className="pad">
        <p className="muted">This table has no columns yet. Import a CSV, or add one in the source.</p>
        {csvBar}
      </div>
    );
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
      {csvBar}
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
