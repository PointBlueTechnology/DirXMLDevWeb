import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { api } from "../api";
import { monacoTheme } from "../monaco";
import { usePending } from "../pending";
import { fieldsOf } from "../prov/formdoc";
import type { FormData, Selection } from "../types";
import { PendingBar } from "./PendingBar";

const TYPES = ["textfield", "textarea", "number", "checkbox", "select", "radio", "datetime", "email", "password", "button", "panel", "columns", "htmlelement", "hidden"];

/**
 * A JSON form: its components as a list to change through the core's `form.field.*` operations,
 * the document itself to edit as JSON, and the PRD activities that show it.
 */
export function FormView({ driver, name, revision, onSelect, onSaved }: { driver: string; name: string; revision: string; onSelect: (s: Selection) => void; onSaved: () => void }) {
  const [data, setData] = useState<FormData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"fields" | "json" | "used">("fields");
  const [draft, setDraft] = useState<string | null>(null);
  const [add, setAdd] = useState({ key: "", type: "textfield", label: "", required: false, where: "" });
  const [title, setTitle] = useState("");
  const pending = usePending();

  useEffect(() => {
    let gone = false;
    api
      .form(driver, name)
      .then((d) => {
        if (!gone) {
          setData(d);
          setDraft(null);
          setError(null);
          setTitle(fieldsOf(d.json).title);
        }
      })
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [driver, name, revision]);

  const doc = useMemo(() => (data ? fieldsOf(data.json) : null), [data]);
  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data || !doc) {
    return <p className="muted pad">Loading…</p>;
  }
  const ref = `${data.kind}/${name}`;
  const base = { form: ref, driver };
  const mapped = new Set(data.usedBy.flatMap((u) => u.fields));
  const jsonDirty = draft !== null && draft !== data.json;
  let draftError: string | null = null;
  if (jsonDirty) {
    try {
      JSON.parse(draft!);
    } catch (e) {
      draftError = e instanceof Error ? e.message : String(e);
    }
  }
  const setField = (key: string, prop: "label" | "required" | "hidden", value: string, was: string) =>
    pending.put(`field:${key}:${prop}`, value === was ? null : { name: "form.field.set", args: { ...base, key, [prop]: value }, label: `${key}: ${prop} = ${value}` });
  const staged = (key: string, prop: string): string | undefined => pending.ops.find((o) => o.key === `field:${key}:${prop}`)?.args[prop];

  return (
    <div className="view form">
      <div className="viewhead">
        <div>
          <div className="kicker">
            {driver} · {data.kind} form
          </div>
          <h2>{name}</h2>
        </div>
        <span className="spacer" />
        <div className="tabs">
          <button className={tab === "fields" ? "tab active" : "tab"} onClick={() => setTab("fields")}>
            Fields
          </button>
          <button className={tab === "json" ? "tab active" : "tab"} onClick={() => setTab("json")} data-testid="form-tab-json">
            JSON{jsonDirty ? " •" : ""}
          </button>
          <button className={tab === "used" ? "tab active" : "tab"} onClick={() => setTab("used")}>
            Used by {data.usedBy.length}
          </button>
        </div>
      </div>
      <PendingBar pending={pending} title={`Review changes to form ${name}`} onSaved={onSaved} />
      {doc.error && <div className="banner error">The form's document is not valid JSON: {doc.error}. Fix it in the JSON tab.</div>}

      {tab === "fields" && (
        <div className="pad scroll">
          <div className="addrow">
            <label className="field">
              <em>Title</em>
              <input value={title} onChange={(e) => (setTitle(e.target.value), pending.put("title", e.target.value === doc.title ? null : { name: "form.set", args: { ...base, title: e.target.value }, label: `title = ${e.target.value}` }))} />
            </label>
            <span className="muted small">display: {doc.display || "form"}</span>
          </div>
          <table className="grid" data-testid="form-fields">
            <thead>
              <tr>
                <th>Key</th>
                <th>Type</th>
                <th>Label</th>
                <th>Required</th>
                <th>Hidden</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {doc.fields.map((f) => (
                <tr key={f.key}>
                  <td style={{ paddingLeft: 8 + f.depth * 18 }}>
                    <code>{f.key}</code>
                    {mapped.has(f.key) && (
                      <span className="pill" title="A PRD maps this field">
                        mapped
                      </span>
                    )}
                  </td>
                  <td className="muted">{f.type}</td>
                  <td className="vcell">
                    <input value={staged(f.key, "label") ?? f.label} className={pending.has(`field:${f.key}:label`) ? "changed" : ""} onChange={(e) => setField(f.key, "label", e.target.value, f.label)} />
                  </td>
                  <td>
                    <input type="checkbox" checked={(staged(f.key, "required") ?? String(f.required)) === "true"} onChange={(e) => setField(f.key, "required", String(e.target.checked), String(f.required))} />
                  </td>
                  <td>
                    <input type="checkbox" checked={(staged(f.key, "hidden") ?? String(f.hidden)) === "true"} onChange={(e) => setField(f.key, "hidden", String(e.target.checked), String(f.hidden))} />
                  </td>
                  <td className="right">
                    <button disabled={f.index === 0} title="Move up" onClick={() => pending.add({ name: "form.field.move", args: { ...base, key: f.key, before: f.siblings[f.index - 1]! }, label: `move ${f.key} before ${f.siblings[f.index - 1]}` })}>
                      ↑
                    </button>{" "}
                    <button
                      disabled={f.index === f.siblings.length - 1}
                      title="Move down"
                      onClick={() => pending.add({ name: "form.field.move", args: { ...base, key: f.key, after: f.siblings[f.index + 1]! }, label: `move ${f.key} after ${f.siblings[f.index + 1]}` })}
                    >
                      ↓
                    </button>{" "}
                    <button onClick={() => pending.add({ name: "form.field.remove", args: { ...base, key: f.key }, label: `remove field ${f.key}` })}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {doc.fields.length === 0 && !doc.error && <p className="muted">The form has no components yet.</p>}
          <div className="addrow">
            <strong className="small">New field</strong>
            <input placeholder="key" value={add.key} onChange={(e) => setAdd({ ...add, key: e.target.value })} spellCheck={false} data-testid="form-add-key" />
            <input list="formtypes" placeholder="type" value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value })} />
            <datalist id="formtypes">
              {TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <input placeholder="label" value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} data-testid="form-add-label" />
            <label className="checkchip">
              <input type="checkbox" checked={add.required} onChange={(e) => setAdd({ ...add, required: e.target.checked })} /> required
            </label>
            <select value={add.where} onChange={(e) => setAdd({ ...add, where: e.target.value })} title="Where the new field goes">
              <option value="">at the end</option>
              {doc.fields.map((f) => (
                <option key={"a" + f.key} value={`after:${f.key}`}>
                  after {f.key}
                </option>
              ))}
              {doc.fields
                .filter((f) => f.container)
                .map((f) => (
                  <option key={"i" + f.key} value={`in:${f.key}`}>
                    inside {f.key}
                  </option>
                ))}
            </select>
            <button
              disabled={!add.key || !add.type || doc.fields.some((f) => f.key === add.key)}
              onClick={() => {
                const args: Record<string, string> = { ...base, key: add.key, type: add.type };
                if (add.label) {
                  args.label = add.label;
                }
                if (add.required) {
                  args.required = "true";
                }
                const [how, target] = add.where.split(":");
                if (how && target) {
                  args[how] = target;
                }
                pending.add({ name: "form.field.add", args, label: `add ${add.type} field ${add.key}` });
                setAdd({ ...add, key: "", label: "" });
              }}
              data-testid="form-add"
            >
              Add
            </button>
          </div>
          <p className="muted small">A field's other properties change in the JSON tab, or through Operations → form.field.set with --prop.</p>
        </div>
      )}

      {tab === "json" && (
        <div className="pad formjson">
          <div className="addrow">
            <button
              disabled={!jsonDirty || draftError !== null}
              onClick={() => pending.put("json", { name: "form.set-content", args: base, files: { "content-file": draft! }, label: "replace the form's document" })}
              data-testid="form-json-stage"
            >
              Stage this document
            </button>
            <button disabled={!jsonDirty} onClick={() => (setDraft(null), pending.put("json", null))}>
              Revert
            </button>
            {draftError && <span className="err-text small">{draftError}</span>}
            <span className="muted small">The core normalises the document and re-syncs every PRD that binds the form.</span>
          </div>
          <div className="editor">
            <Editor language="json" value={draft ?? data.json} theme={monacoTheme()} onChange={(v) => setDraft(v ?? "")} options={{ minimap: { enabled: false }, scrollBeyondLastLine: false }} />
          </div>
        </div>
      )}

      {tab === "used" && (
        <div className="pad scroll">
          {data.usedBy.length === 0 ? (
            <p className="muted">No PRD shows this form.</p>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>PRD</th>
                  <th>Shown at</th>
                  <th>Fields it maps</th>
                </tr>
              </thead>
              <tbody>
                {data.usedBy.map((u, i) => (
                  <tr key={i}>
                    <td>
                      <button className="link" onClick={() => onSelect({ type: "prd", driver, name: u.prd })}>
                        {u.prd}
                      </button>
                    </td>
                    <td>{u.activity ?? "the request"}</td>
                    <td>{u.fields.length === 0 ? <span className="muted">none</span> : u.fields.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            File: <button className="link" onClick={() => onSelect({ type: "file", file: data.file })}>{data.file}</button>
          </p>
        </div>
      )}
    </div>
  );
}
