import type { ReactNode } from "react";
import type { Definition } from "../types";

interface Props {
  rows: Definition[];
  /** The value an edit has staged for a row, if any. */
  staged: (name: string) => string | undefined;
  onChange: (row: Definition, value: string) => void;
  /** Extra cells after the value (where defined, per-environment overrides). */
  extra?: (row: Definition) => ReactNode;
  extraHead?: ReactNode;
  onDelete?: (row: Definition) => void;
  empty: string;
  /** Rows come grouped (already in group order); a header row is drawn where the group changes. */
  group?: (row: Definition) => { key: string; title: string; note?: string } | null;
  /** A second line under each definition (where defined, who uses it, per-environment values): the value line keeps its room. */
  meta?: (row: Definition) => ReactNode;
}

/** Configuration definitions as a table: one row each, with an input that fits the type. */
export function DefinitionsTable({ rows, staged, onChange, extra, extraHead, onDelete, empty, group, meta }: Props) {
  let lastGroup: string | null = null;
  // a spanning row needs the real column count: Chrome gives a colspan past the last column only the first one
  const span = extra ? 99 : 3 + (onDelete ? 1 : 0);
  if (rows.length === 0) {
    return <p className="muted pad">{empty}</p>;
  }
  return (
    <table className="defs">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Value</th>
          {extraHead}
          {onDelete && <th />}
        </tr>
      </thead>
      <tbody>
        {rows.flatMap((row) => {
          const s = staged(row.name);
          const value = s ?? row.value;
          const out = [];
          const g = group?.(row) ?? null;
          if (g && g.key !== lastGroup) {
            lastGroup = g.key;
            out.push(
              <tr key={"group:" + g.key} className="group" data-testid="defs-group">
                <td colSpan={span}>
                  <strong>{g.title}</strong>
                  {g.note && <span className="muted small"> — {g.note}</span>}
                </td>
              </tr>,
            );
          }
          out.push(
            <tr key={row.name} className={(s !== undefined ? "changed" : "") + (meta ? " defmain" : "")}>
              <td title={row.description || row.name}>
                <div className="dname">{row.displayName}</div>
                <code>{row.name}</code>
              </td>
              <td className="muted">{row.type || "string"}</td>
              <td className="vcell">
                <ValueInput row={row} value={value} onChange={(v) => onChange(row, v)} />
              </td>
              {extra?.(row)}
              {onDelete && (
                <td>
                  <button className="mini danger" title="Delete this definition" onClick={() => onDelete(row)}>
                    ×
                  </button>
                </td>
              )}
            </tr>,
          );
          if (meta) {
            out.push(
              <tr key={row.name + ":meta"} className={(s !== undefined ? "changed" : "") + " defmeta"} data-testid={"defs-meta-" + row.name}>
                <td colSpan={span}>{meta(row)}</td>
              </tr>,
            );
          }
          return out;
        })}
      </tbody>
    </table>
  );
}

export function ValueInput({ row, value, onChange }: { row: Definition; value: string; onChange: (v: string) => void }) {
  if (!row.editable) {
    return (
      <span className="muted small" title="A list or structured value: edit the document's XML">
        {row.type} value — edit in XML
      </span>
    );
  }
  if (row.type === "boolean") {
    return (
      <select value={value === "true" ? "true" : "false"} onChange={(e) => onChange(e.target.value)}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (row.type === "enum" && row.choices.length > 0) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!row.choices.some((c) => c.value === value) && <option value={value}>{value || "(unset)"}</option>}
        {row.choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    );
  }
  return <input type={row.type === "integer" ? "number" : "text"} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />;
}
