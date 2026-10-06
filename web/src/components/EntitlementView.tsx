import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { api } from "../api";
import { monacoTheme } from "../monaco";
import { usePending } from "../pending";
import { parseEntitlement, writeEntitlement } from "../prov/entitlement";
import type { Selection, TreeFile } from "../types";
import { PendingBar } from "./PendingBar";

/**
 * An entitlement as Designer's editor shows it: display name, description, conflict resolution,
 * multi-valued, and where its values come from — none, a static list, or a query against the
 * application. The attributes and the static list change through `entitlement.set`; the query
 * is read here and edited as XML, which `entitlement.set --definition-file` saves whole.
 */
export function EntitlementView({ driver, name, file, revision, onSelect, onSaved }: { driver: string; name: string; file: string; revision: string; onSelect: (s: Selection) => void; onSaved: () => void }) {
  const [data, setData] = useState<TreeFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"editor" | "xml">("editor");
  const [draft, setDraft] = useState<string | null>(null);
  const [fields, setFields] = useState({ displayName: "", description: "", conflict: "priority", multiValued: false });
  const [values, setValues] = useState<string[]>([]);
  const [newValue, setNewValue] = useState("");
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
  const stage = (f: typeof fields, list: string[]) => {
    const valuesSame = list.length === doc.values.length && list.every((v, i) => v === doc.values[i]);
    for (const k of ["display", "descr", "conflict", "multi", "definition"]) {
      pending.put(`ent:${k}`, null);
    }
    if (!valuesSame) {
      pending.put("ent:definition", {
        name: "entitlement.set",
        args: base,
        files: { "definition-file": writeEntitlement(data.content, f, list) },
        label: `${name}: ${list.length} value${list.length === 1 ? "" : "s"}${f.displayName !== doc.displayName ? ", display name" : ""}${f.conflict !== doc.conflict ? ", conflict resolution" : ""}`,
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
    stage(f, values);
  };
  const stageValues = (list: string[]) => {
    setValues(list);
    stage(fields, list);
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
              <input value={fields.description} onChange={(e) => update({ ...fields, description: e.target.value })} />
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
          {doc.mode === "query" && doc.query && (
            <div className="block">
              <p>
                <span className="pill">queried from the application</span> The driver asks the connected system for the choices when an entitlement is granted or a role is designed.
              </p>
              <table className="grid">
                <tbody>
                  <tr>
                    <th>Query</th>
                    <td>
                      class <code>{doc.query.className ?? "?"}</code>, scope <code>{doc.query.scope ?? "subtree"}</code>
                      {doc.query.searchClasses.length > 0 && (
                        <>
                          , search class{doc.query.searchClasses.length === 1 ? "" : "es"} <code>{doc.query.searchClasses.join(", ")}</code>
                        </>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th>Attributes read</th>
                    <td>{doc.query.readAttrs.length === 0 ? <span className="muted">none</span> : doc.query.readAttrs.map((a) => <code key={a}>{a} </code>)}</td>
                  </tr>
                  <tr>
                    <th>Shown as</th>
                    <td>
                      name <code>{doc.query.displayName ?? "—"}</code>
                      {doc.query.description && (
                        <>
                          , description <code>{doc.query.description}</code>
                        </>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th>Value granted</th>
                    <td>
                      <code>{doc.query.value ?? "—"}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="muted small">The query and its result tokens are edited in the XML tab (<code>&lt;query-app&gt;</code>); the core has no typed operation for them yet.</p>
            </div>
          )}
          {doc.mode !== "query" && (
            <div className="block">
              <p>
                {values.length === 0 ? (
                  <>
                    <span className="pill">no list</span> The requester supplies the value when the entitlement is granted — an account entitlement needs none; otherwise it is the connected system's key for the thing granted, as an association holds it.
                  </>
                ) : (
                  <>
                    <span className="pill">static list</span> The choices offered when the entitlement is granted: each is the connected system's key for the thing (a GUID, an id, a name, a DN — whatever that system uses, as in an association).
                  </>
                )}
              </p>
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
              <p className="muted small">A query against the application instead of a list is written in the XML tab as <code>&lt;values&gt;&lt;query-app&gt;…</code>.</p>
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
