import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { api } from "../api";
import { monacoTheme } from "../monaco";
import { usePending } from "../pending";
import { defaultQuery, parseEntitlement, writeEntitlement } from "../prov/entitlement";
import type { EntitlementQuery } from "../prov/entitlement";
import type { Selection, TreeFile } from "../types";
import { PendingBar } from "./PendingBar";

/**
 * An entitlement as Designer's editor shows it: display name, description, conflict resolution,
 * multi-valued, and where its values come from — none, a static list, or a query against the
 * application. The attributes and the static list change through `entitlement.set`; the query
 * is read here and edited as XML, which `entitlement.set --definition-file` saves whole.
 */
function list(csv: string): string[] {
  return csv
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function EntitlementView({ driver, name, file, revision, onSelect, onSaved }: { driver: string; name: string; file: string; revision: string; onSelect: (s: Selection) => void; onSaved: () => void }) {
  const [data, setData] = useState<TreeFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"editor" | "xml">("editor");
  const [draft, setDraft] = useState<string | null>(null);
  const [fields, setFields] = useState({ displayName: "", description: "", conflict: "priority", multiValued: false });
  const [values, setValues] = useState<string[]>([]);
  const [newValue, setNewValue] = useState("");
  const [mode, setMode] = useState<"none" | "static" | "query">("none");
  const [query, setQuery] = useState<EntitlementQuery>(defaultQuery());
  const pending = usePending();

  useEffect(() => {
    let gone = false;
    api
      .file(file)
      .then((f) => {
        if (!gone) {
          setData(f);
          setDraft(null);
          setError(null);
          const e = parseEntitlement(f.content);
          setFields({ displayName: e.displayName, description: e.description, conflict: e.conflict, multiValued: e.multiValued ?? false });
          setValues(e.values);
          setMode(e.mode);
          setQuery(e.query ?? defaultQuery());
        }
      })
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [file, revision]);

  const doc = useMemo(() => (data ? parseEntitlement(data.content) : null), [data]);
  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data || !doc) {
    return <p className="muted pad">Loading…</p>;
  }
  const base = { name, driver };
  /**
   * Stage what differs from the file. Attribute changes alone are typed operations, one each;
   * once the value list differs the whole definition is staged instead (a value is the connected
   * system's key for the thing granted and may hold anything, commas included, which the typed
   * `--values` list cannot), carrying the attributes with it.
   */
  const sameQuery = (a: EntitlementQuery | null, b: EntitlementQuery | null) => JSON.stringify(a) === JSON.stringify(b);
  const stage = (f: typeof fields, m: typeof mode, list: string[], q: EntitlementQuery) => {
    const valuesSame = m === doc.mode && (m === "query" ? sameQuery(q, doc.query) : list.length === doc.values.length && list.every((v, i) => v === doc.values[i]));
    for (const k of ["display", "descr", "conflict", "multi", "definition"]) {
      pending.put(`ent:${k}`, null);
    }
    if (!valuesSame) {
      const what = m === "query" ? "values from a query" : m === "static" && list.length > 0 ? `${list.length} value${list.length === 1 ? "" : "s"}` : "no value list";
      pending.put("ent:definition", {
        name: "entitlement.set",
        args: base,
        files: { "definition-file": writeEntitlement(data.content, f, m === "query" ? null : m === "static" ? list : [], m === "query" ? q : null) },
        label: `${name}: ${what}${f.displayName !== doc.displayName ? ", display name" : ""}${f.conflict !== doc.conflict ? ", conflict resolution" : ""}`,
      });
      return;
    }
    if (f.displayName !== doc.displayName) {
      pending.put("ent:display", { name: "entitlement.set", args: { ...base, "display-name": f.displayName }, label: `${name}: display name = ${f.displayName}` });
    }
    if (f.description !== doc.description) {
      pending.put("ent:descr", { name: "entitlement.set", args: { ...base, description: f.description }, label: `${name}: description = ${f.description}` });
    }
    if (f.conflict !== doc.conflict) {
      pending.put("ent:conflict", { name: "entitlement.set", args: { ...base, conflict: f.conflict }, label: `${name}: conflict resolution = ${f.conflict}` });
    }
    if (f.multiValued !== (doc.multiValued ?? false)) {
      pending.put("ent:multi", { name: "entitlement.set", args: { ...base, "multi-valued": String(f.multiValued) }, label: `${name}: multi-valued = ${f.multiValued}` });
    }
  };
  const update = (f: typeof fields) => {
    setFields(f);
    stage(f, mode, values, query);
  };
  const stageValues = (list: string[]) => {
    setValues(list);
    stage(fields, list.length === 0 && mode === "static" ? "none" : mode, list, query);
    if (list.length === 0 && mode === "static") {
      setMode("none");
    }
  };
  const switchMode = (m: typeof mode) => {
    setMode(m);
    stage(fields, m, values, query);
  };
  const updateQuery = (q: EntitlementQuery) => {
    setQuery(q);
    stage(fields, "query", values, q);
  };
  const jsonDirty = draft !== null && draft !== data.content;

  return (
    <div className="view entitlement">
      <div className="viewhead">
        <div>
          <div className="kicker">{driver} · entitlement</div>
          <h2>{name}</h2>
        </div>
        <span className="spacer" />
        <div className="tabs">
          <button className={tab === "editor" ? "tab active" : "tab"} onClick={() => setTab("editor")}>
            Editor
          </button>
          <button className={tab === "xml" ? "tab active" : "tab"} onClick={() => setTab("xml")} data-testid="ent-tab-xml">
            XML{jsonDirty ? " •" : ""}
          </button>
        </div>
      </div>
      <PendingBar pending={pending} title={`Review changes to entitlement ${name}`} onSaved={onSaved} />
      {doc.error && <div className="banner error">{doc.error}. Fix it in the XML tab.</div>}

      {tab === "editor" && !doc.error && (
        <div className="pad scroll">
          <div className="attrs">
            <label className="field wide">
              <em>Display name</em>
              <input value={fields.displayName} onChange={(e) => update({ ...fields, displayName: e.target.value })} data-testid="ent-display" />
            </label>
            <label className="field wide">
              <em>Description</em>
              <textarea value={fields.description} rows={Math.min(6, Math.max(2, Math.ceil(fields.description.length / 90)))} onChange={(e) => update({ ...fields, description: e.target.value.replace(/\r?\n/g, " ") })} data-testid="ent-description" />
            </label>
            <label className="field">
              <em>Conflict resolution</em>
              <select value={fields.conflict} onChange={(e) => update({ ...fields, conflict: e.target.value })} data-testid="ent-conflict">
                <option value="priority">priority — the highest-priority assignment wins</option>
                <option value="union">union — every assignment's value is granted</option>
              </select>
            </label>
            <label className="checkchip">
              <input type="checkbox" checked={fields.multiValued} onChange={(e) => update({ ...fields, multiValued: e.target.checked })} /> multi-valued (a user may hold several
              values)
            </label>
          </div>

          <h3>Values</h3>
          <div className="addrow tight modes" data-testid="ent-mode">
            {(["none", "static", "query"] as const).map((m) => (
              <label key={m} className={"checkchip" + (mode === m ? " on" : "")}>
                <input type="radio" name="ent-mode" checked={mode === m} onChange={() => switchMode(m)} /> {m === "none" ? "the requester gives the value" : m === "static" ? "a fixed list" : "queried from the application"}
              </label>
            ))}
          </div>
          {mode === "none" && (
            <p className="muted small">No list: an account entitlement needs none; otherwise the person or role supplies the connected system's key for the thing granted, as an association holds it.</p>
          )}
          {mode === "static" && (
            <div className="block">
              <p className="muted small">The choices offered when the entitlement is granted: each is the connected system's key for the thing (a GUID, an id, a name, a DN — whatever that system uses, as in an association).</p>
              <ul className="filelist" data-testid="ent-values">
                {values.map((v, i) => (
                  <li key={i} className="dataitem">
                    <code>{v}</code>
                    <button onClick={() => stageValues(values.filter((_, j) => j !== i))}>Remove</button>
                  </li>
                ))}
              </ul>
              <div className="addrow tight">
                <input className="wide" placeholder="the system's key for the thing granted: a GUID, an id, a group name, a DN…" value={newValue} onChange={(e) => setNewValue(e.target.value)} spellCheck={false} data-testid="ent-new-value" />
                <button disabled={!newValue.trim()} onClick={() => (stageValues([...values, newValue.trim()]), setNewValue(""))} data-testid="ent-add-value">
                  Add value
                </button>
              </div>
            </div>
          )}
          {mode === "query" && (
            <div className="block" data-testid="ent-query">
              <p className="muted small">The driver asks the connected system for the choices (when a role is designed, or an entitlement granted). Say what to search for, what to read, and how each result is shown and granted.</p>
              <div className="attrs">
                <label className="field">
                  <em>Class to query</em>
                  <input value={query.className ?? ""} onChange={(e) => updateQuery({ ...query, className: e.target.value })} placeholder="group" spellCheck={false} data-testid="ent-q-class" />
                </label>
                <label className="field">
                  <em>Scope</em>
                  <select value={query.scope ?? "subtree"} onChange={(e) => updateQuery({ ...query, scope: e.target.value })}>
                    <option value="subtree">subtree</option>
                    <option value="subordinates">subordinates</option>
                    <option value="entry">entry</option>
                  </select>
                </label>
                <label className="field">
                  <em>Search classes (comma-separated; empty = the class)</em>
                  <input value={query.searchClasses.join(", ")} onChange={(e) => updateQuery({ ...query, searchClasses: list(e.target.value) })} placeholder="group" spellCheck={false} />
                </label>
                <label className="field">
                  <em>Attributes to read (comma-separated)</em>
                  <input value={query.readAttrs.join(", ")} onChange={(e) => updateQuery({ ...query, readAttrs: list(e.target.value) })} placeholder="CN, description" spellCheck={false} data-testid="ent-q-attrs" />
                </label>
              </div>
              <h4>Each result</h4>
              <p className="muted small">
                Write <code>{"{attr}"}</code> for an attribute read above, <code>{"{src-dn}"}</code> for the object's DN, <code>{"{association}"}</code> for its association; other text is kept as written.
              </p>
              <div className="attrs">
                <label className="field">
                  <em>Shown as (name)</em>
                  <input value={query.displayName ?? ""} onChange={(e) => updateQuery({ ...query, displayName: e.target.value || null })} placeholder="{CN}" spellCheck={false} data-testid="ent-q-name" />
                </label>
                <label className="field">
                  <em>Description</em>
                  <input value={query.description ?? ""} onChange={(e) => updateQuery({ ...query, description: e.target.value || null })} placeholder="{description}" spellCheck={false} />
                </label>
                <label className="field">
                  <em>Value granted</em>
                  <input value={query.value ?? ""} onChange={(e) => updateQuery({ ...query, value: e.target.value || null })} placeholder="{association}" spellCheck={false} data-testid="ent-q-value" />
                </label>
              </div>
            </div>
          )}
          <p className="muted small">
            File:{" "}
            <button className="link" onClick={() => onSelect({ type: "file", file })}>
              {file}
            </button>
          </p>
        </div>
      )}

      {tab === "xml" && (
        <div className="pad formjson">
          <div className="addrow">
            <button
              disabled={!jsonDirty}
              onClick={() => pending.put("ent:xml", { name: "entitlement.set", args: base, files: { "definition-file": draft! }, label: `replace the definition of entitlement ${name}` })}
              data-testid="ent-xml-stage"
            >
              Stage this document
            </button>
            <button disabled={!jsonDirty} onClick={() => (setDraft(null), pending.put("ent:xml", null))}>
              Revert
            </button>
          </div>
          <div className="editor">
            <Editor language="xml" value={draft ?? data.content} theme={monacoTheme()} onChange={(v) => setDraft(v ?? "")} options={{ minimap: { enabled: false }, scrollBeyondLastLine: false }} />
          </div>
        </div>
      )}
    </div>
  );
}
