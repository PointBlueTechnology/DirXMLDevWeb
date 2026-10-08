import { useEffect, useState } from "react";
import { api } from "../api";
import { usePending } from "../pending";
import { invalidateSchema, loadClass } from "../schema";
import { EnvPicker, useEnvironment } from "../env";
import type { SchemaActionResult, SchemaClass, SchemaData } from "../types";
import { PendingBar } from "./PendingBar";

const SYNTAXES: [string, string][] = [
  ["1.3.6.1.4.1.1466.115.121.1.15", "Directory String (case-ignore)"],
  ["1.3.6.1.4.1.1466.115.121.1.26", "IA5 String (case-exact)"],
  ["1.3.6.1.4.1.1466.115.121.1.27", "Integer"],
  ["1.3.6.1.4.1.1466.115.121.1.7", "Boolean"],
  ["1.3.6.1.4.1.1466.115.121.1.12", "DN"],
  ["1.3.6.1.4.1.1466.115.121.1.24", "Generalized Time"],
  ["1.3.6.1.4.1.1466.115.121.1.40", "Octet String"],
];

/**
 * The vault's schema as the tree keeps it: classes and attributes, the ones you defined marked and
 * editable, *Refresh from vault* and *Push additions* (a plan, then the environment's name typed).
 * Nothing here reads the vault on its own.
 */
export function SchemaView({ revision, onSaved }: { revision: string; onSaved: () => void }) {
  const [data, setData] = useState<SchemaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"classes" | "attributes">("classes");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Record<string, SchemaClass | null>>({});
  const { envs, env, setEnv } = useEnvironment();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<SchemaActionResult | null>(null);
  const [confirm, setConfirm] = useState("");
  const [addAttr, setAddAttr] = useState({ name: "", ldap: "", syntax: SYNTAXES[0]![0], oid: "", single: false });
  const [addClass, setAddClass] = useState({ name: "", ldap: "", kind: "auxiliary", oid: "", superclasses: "Top", mandatory: "", optional: "" });
  const pending = usePending();

  const load = () => {
    invalidateSchema();
    api
      .schema()
      .then((d) => (setData(d), setError(null)))
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, [revision]);

  const act = (what: string, run: () => Promise<SchemaActionResult>) => {
    setBusy(what);
    setResult(null);
    run()
      .then((r) => {
        setResult(r);
        if (r.ok && what !== "plan") {
          onSaved();
          load();
        }
      })
      .catch((e: Error) => setResult({ ok: false, refusal: e.message, done: [], skipped: [], failures: [], text: "" }))
      .finally(() => setBusy(null));
  };

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data) {
    return <p className="muted pad">Loading the schema…</p>;
  }
  const q = filter.trim().toLowerCase();
  const hit = (n: string, l: string) => !q || n.toLowerCase().includes(q) || l.toLowerCase().includes(q);
  const classes = (data.classes ?? []).filter((c) => hit(c.name, c.ldap));
  const attrs = (data.attributes ?? []).filter((a) => hit(a.name, a.ldap));
  const customCount = (data.customAttributes ?? 0) + (data.customClasses ?? 0);
  const toggle = (name: string) => {
    if (name in open) {
      const next = { ...open };
      delete next[name];
      setOpen(next);
      return;
    }
    setOpen({ ...open, [name]: null });
    loadClass(name)
      .then((c) => setOpen((o) => (name in o ? { ...o, [name]: c } : o)))
      .catch(() => undefined);
  };

  return (
    <div className="schemaview" data-testid="schema">
      <PendingBar pending={pending} title="Review schema definitions" onSaved={onSaved} />
      <div className="pad-x">
        <div className="addrow" data-testid="schema-actions">
          {data.present ? (
            <span className="small">
              <strong>{data.classes?.length}</strong> classes, <strong>{data.attributes?.length}</strong> attributes
              {customCount > 0 && <span className="pill warn"> {customCount} defined here</span>}
              <span className="muted"> · from {data.source} at {(data["read-at"] ?? "").replace("T", " ").slice(0, 16)}</span>
            </span>
          ) : (
            <span className="muted small">The tree has no schema yet. Read it from a vault, or import a Designer project (its copy comes along).</span>
          )}
          <span className="spacer" />
          {envs && envs.length > 0 ? <EnvPicker envs={envs} env={env} setEnv={setEnv} testid="schema-env" /> : <span className="muted small">no environment</span>}
          <button disabled={!env || busy !== null} onClick={() => act("refresh", () => api.vault.refreshSchema(env))} title="Read cn=schema of the environment into the tree (a read of the vault)" data-testid="schema-refresh">
            {busy === "refresh" ? "Reading…" : "Refresh from vault"}
          </button>
          {customCount > 0 && (
            <>
              <button disabled={!env || busy !== null} onClick={() => act("plan", () => api.vault.deploySchema(env))} title="What the push would add — nothing written" data-testid="schema-plan">
                {busy === "plan" ? "Planning…" : "Plan the push"}
              </button>
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`type ${env || "the environment"} to push`} spellCheck={false} autoComplete="off" data-testid="schema-confirm" />
              <button className="primary" disabled={!env || confirm !== env || busy !== null} onClick={() => act("push", () => api.vault.deploySchema(env, confirm))} data-testid="schema-push">
                {busy === "push" ? "Pushing…" : "Push additions to vault"}
              </button>
            </>
          )}
        </div>
        {result && (
          <div className={result.ok ? "banner" : "banner error"} data-testid="schema-result">
            {result.refusal && <div>{result.refusal}</div>}
            {result.done.length > 0 && <div>{result.done.join(" · ")}</div>}
            {result.skipped.length > 0 && <div className="muted">{result.skipped.join(" · ")}</div>}
            {result.failures.length > 0 && <div className="err-text">{result.failures.join(" · ")}</div>}
            {!result.refusal && result.done.length === 0 && result.failures.length === 0 && <div>{(result.text || "").trim() || "done"}</div>}
          </div>
        )}
        <div className="tabs">
          <button className={tab === "classes" ? "tab active" : "tab"} onClick={() => setTab("classes")} data-testid="schema-tab-classes">
            Classes {data.classes?.length ?? 0}
          </button>
          <button className={tab === "attributes" ? "tab active" : "tab"} onClick={() => setTab("attributes")} data-testid="schema-tab-attributes">
            Attributes {data.attributes?.length ?? 0}
          </button>
          <input className="outline-filter" style={{ width: 240 }} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter by name…" spellCheck={false} data-testid="schema-filter" />
        </div>
      </div>
      <div className="pad scroll">
        {tab === "classes" && (
          <>
            <table className="grid" data-testid="schema-classes">
              <thead>
                <tr>
                  <th />
                  <th>Class</th>
                  <th>LDAP name</th>
                  <th>Kind</th>
                  <th>Superclasses</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {classes.slice(0, 400).flatMap((c) => {
                  const rows = [
                    <tr key={c.name} className={c.custom ? "custom" : ""}>
                      <td>
                        <button className="mini" onClick={() => toggle(c.name)} title="Its attributes, superclasses' included">
                          {c.name in open ? "▾" : "▸"}
                        </button>
                      </td>
                      <td>
                        <strong>{c.name}</strong>
                        {c.custom && <span className="pill warn"> defined here</span>}
                      </td>
                      <td>
                        <code>{c.ldap}</code>
                      </td>
                      <td className="muted small">
                        {c.kind}
                        {c.container ? " · container" : ""}
                      </td>
                      <td className="small">{c.superclasses.join(", ")}</td>
                      <td className="right">{c.custom && <button onClick={() => pending.add({ name: "schema.remove", args: { name: c.name }, label: `remove class ${c.name} from the tree's schema` })}>Remove</button>}</td>
                    </tr>,
                  ];
                  if (c.name in open) {
                    const d = open[c.name];
                    rows.push(
                      <tr key={c.name + ":attrs"} className="detail">
                        <td />
                        <td colSpan={5}>
                          {!d ? (
                            <span className="muted small">…</span>
                          ) : (
                            <>
                              {d.naming.length > 0 && <div className="small muted">naming: {d.naming.join(", ")} · containment: {d.containment.join(", ") || "—"}</div>}
                              <div className="chips">
                                {d.attributes.map((a) => (
                                  <span key={a.name} className={"chip" + (a.mandatory ? " mandatory" : "")} title={`${a.ldap}${a.syntax ? " · " + a.syntax : ""}${a.single ? " · single" : ""}${a.mandatory ? " · mandatory" : ""}`}>
                                    {a.name}
                                  </span>
                                ))}
                              </div>
                            </>
                          )}
                        </td>
                      </tr>,
                    );
                  }
                  return rows;
                })}
              </tbody>
            </table>
            {classes.length > 400 && <p className="muted small">{classes.length - 400} more — narrow the filter.</p>}
            {data.present && (
              <div className="addrow" data-testid="schema-add-class">
                <strong className="small">New class</strong>
                <input placeholder="name" value={addClass.name} onChange={(e) => setAddClass({ ...addClass, name: e.target.value })} spellCheck={false} />
                <input placeholder="LDAP name" value={addClass.ldap} onChange={(e) => setAddClass({ ...addClass, ldap: e.target.value })} spellCheck={false} />
                <select value={addClass.kind} onChange={(e) => setAddClass({ ...addClass, kind: e.target.value })}>
                  <option value="auxiliary">auxiliary</option>
                  <option value="structural">structural</option>
                  <option value="abstract">abstract</option>
                </select>
                <input placeholder="superclasses" value={addClass.superclasses} onChange={(e) => setAddClass({ ...addClass, superclasses: e.target.value })} spellCheck={false} list="schema-class-names" />
                <input placeholder="mandatory attributes, comma-separated" value={addClass.mandatory} onChange={(e) => setAddClass({ ...addClass, mandatory: e.target.value })} spellCheck={false} />
                <input placeholder="optional attributes, comma-separated" value={addClass.optional} onChange={(e) => setAddClass({ ...addClass, optional: e.target.value })} spellCheck={false} />
                <input placeholder="OID (needed to push)" value={addClass.oid} onChange={(e) => setAddClass({ ...addClass, oid: e.target.value })} spellCheck={false} />
                <button
                  disabled={!addClass.name.trim()}
                  onClick={() => {
                    const args: Record<string, string> = { name: addClass.name.trim(), kind: addClass.kind };
                    for (const k of ["ldap", "oid", "superclasses", "mandatory", "optional"] as const) {
                      if (addClass[k].trim()) {
                        args[k] = addClass[k].trim();
                      }
                    }
                    pending.add({ name: "schema.add-class", args, label: `define class ${addClass.name.trim()} (${addClass.kind})` });
                    setAddClass({ ...addClass, name: "", ldap: "", oid: "", mandatory: "", optional: "" });
                  }}
                >
                  Define
                </button>
              </div>
            )}
          </>
        )}
        {tab === "attributes" && (
          <>
            <table className="grid" data-testid="schema-attributes">
              <thead>
                <tr>
                  <th>Attribute</th>
                  <th>LDAP name</th>
                  <th>Syntax</th>
                  <th />
                  <th />
                </tr>
              </thead>
              <tbody>
                {attrs.slice(0, 500).map((a) => (
                  <tr key={a.name} className={a.custom ? "custom" : ""}>
                    <td>
                      <strong>{a.name}</strong>
                      {a.custom && <span className="pill warn"> defined here</span>}
                    </td>
                    <td>
                      <code>{a.ldap}</code>
                    </td>
                    <td className="small muted">{SYNTAXES.find(([oid]) => oid === a.syntax)?.[1] ?? a.syntax ?? "—"}</td>
                    <td className="small muted">{a.single ? "single" : ""}</td>
                    <td className="right">{a.custom && <button onClick={() => pending.add({ name: "schema.remove", args: { name: a.name }, label: `remove attribute ${a.name} from the tree's schema` })}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {attrs.length > 500 && <p className="muted small">{attrs.length - 500} more — narrow the filter.</p>}
            {data.present && (
              <div className="addrow" data-testid="schema-add-attr">
                <strong className="small">New attribute</strong>
                <input placeholder="name" value={addAttr.name} onChange={(e) => setAddAttr({ ...addAttr, name: e.target.value })} spellCheck={false} />
                <input placeholder="LDAP name" value={addAttr.ldap} onChange={(e) => setAddAttr({ ...addAttr, ldap: e.target.value })} spellCheck={false} />
                <select value={addAttr.syntax} onChange={(e) => setAddAttr({ ...addAttr, syntax: e.target.value })}>
                  {SYNTAXES.map(([oid, label]) => (
                    <option key={oid} value={oid}>
                      {label}
                    </option>
                  ))}
                </select>
                <label className="checkchip">
                  <input type="checkbox" checked={addAttr.single} onChange={(e) => setAddAttr({ ...addAttr, single: e.target.checked })} /> single-valued
                </label>
                <input placeholder="OID (needed to push)" value={addAttr.oid} onChange={(e) => setAddAttr({ ...addAttr, oid: e.target.value })} spellCheck={false} />
                <button
                  disabled={!addAttr.name.trim()}
                  onClick={() => {
                    const args: Record<string, string> = { name: addAttr.name.trim(), syntax: addAttr.syntax };
                    if (addAttr.ldap.trim()) {
                      args.ldap = addAttr.ldap.trim();
                    }
                    if (addAttr.oid.trim()) {
                      args.oid = addAttr.oid.trim();
                    }
                    if (addAttr.single) {
                      args.single = "true";
                    }
                    pending.add({ name: "schema.add-attribute", args, label: `define attribute ${addAttr.name.trim()}` });
                    setAddAttr({ ...addAttr, name: "", ldap: "", oid: "", single: false });
                  }}
                >
                  Define
                </button>
              </div>
            )}
          </>
        )}
        <datalist id="schema-class-names">
          {(data.classes ?? []).map((c) => (
            <option key={c.name} value={c.name} />
          ))}
        </datalist>
        <p className="muted small">Definitions you make are marked and pushed with their OIDs; the vault's own are read-only here, and nothing is ever removed from a vault's schema. Refreshing keeps your definitions.</p>
      </div>
    </div>
  );
}
