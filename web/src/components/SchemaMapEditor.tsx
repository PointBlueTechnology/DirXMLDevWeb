import { useState } from "react";
import { parseSchemaMap, type MapAttr } from "../configxml";
import type { Pending } from "../pending";

/** A schema map as two columns of names, per class (`schema-map.set`, `schema-map.remove`). */
export function SchemaMapEditor({ driver, content, pending }: { driver: string; content: string; pending: Pending }) {
  const map = parseSchemaMap(content);
  const [newClass, setNewClass] = useState({ nds: "", app: "" });
  const [newAttr, setNewAttr] = useState<Record<string, MapAttr>>({});
  if (!map) {
    return <div className="banner error">The source is not an &lt;attr-name-map&gt;.</div>;
  }
  const staged = (key: string) => pending.ops.find((o) => o.key === key);
  const removed = (key: string) => !!staged(key);

  const appInput = (key: string, original: string, make: (app: string) => { args: Record<string, string>; label: string }) => (
    <input
      value={staged(key)?.args[key.startsWith("smc:") ? "app-class" : "app-attr"] ?? original}
      className={staged(key) ? "changed" : ""}
      spellCheck={false}
      onChange={(e) => {
        const app = e.target.value;
        if (app === original || app === "") {
          pending.put(key, null);
        } else {
          const { args, label } = make(app);
          pending.put(key, { name: "schema-map.set", args, label });
        }
      }}
    />
  );

  const attrRows = (cls: string | null, attrs: MapAttr[]) =>
    attrs.map((a) => {
      const key = `sma:${cls ?? ""}:${a.nds}`;
      const delKey = `smadel:${cls ?? ""}:${a.nds}`;
      const delArgs: Record<string, string> = cls ? { driver, "nds-class": cls, "nds-attr": a.nds } : { driver, "nds-attr": a.nds };
      return (
        <tr key={a.nds} className={removed(delKey) ? "removed" : staged(key) ? "changed" : ""}>
          <td>{a.nds}</td>
          <td className="vcell">
            {appInput(key, a.app, (app) => {
              const args: Record<string, string> = cls ? { driver, "nds-class": cls, "nds-attr": a.nds, "app-attr": app } : { driver, "nds-attr": a.nds, "app-attr": app };
              return { args, label: `${cls ? cls + "." : ""}${a.nds} ↔ ${app}` };
            })}
          </td>
          <td>
            <button className="mini danger" onClick={() => pending.put(delKey, removed(delKey) ? null : { name: "schema-map.remove", args: delArgs, label: `unmap ${cls ? cls + "." : ""}${a.nds}` })}>
              {removed(delKey) ? "keep" : "×"}
            </button>
          </td>
        </tr>
      );
    });

  const addAttr = (cls: string | null) => {
    const k = cls ?? "";
    const d = newAttr[k] ?? { nds: "", app: "" };
    return (
      <div className="addrow">
        <input placeholder="eDirectory attribute" value={d.nds} onChange={(e) => setNewAttr({ ...newAttr, [k]: { ...d, nds: e.target.value } })} />
        <input placeholder="application attribute" value={d.app} onChange={(e) => setNewAttr({ ...newAttr, [k]: { ...d, app: e.target.value } })} />
        <button
          disabled={!d.nds.trim() || !d.app.trim()}
          onClick={() => {
            const args: Record<string, string> = cls ? { driver, "nds-class": cls, "nds-attr": d.nds.trim(), "app-attr": d.app.trim() } : { driver, "nds-attr": d.nds.trim(), "app-attr": d.app.trim() };
            pending.put(`smanew:${k}:${d.nds.trim()}`, { name: "schema-map.set", args, label: `map ${cls ? cls + "." : ""}${d.nds.trim()} ↔ ${d.app.trim()}` });
            setNewAttr({ ...newAttr, [k]: { nds: "", app: "" } });
          }}
        >
          Map attribute
        </button>
      </div>
    );
  };

  const head = (
    <thead>
      <tr>
        <th>eDirectory name</th>
        <th>Application name</th>
        <th />
      </tr>
    </thead>
  );

  return (
    <div className="pad">
      {map.classes.map((c) => {
        const ckey = `smc:${c.nds}`;
        const cdel = `smcdel:${c.nds}`;
        return (
          <section key={c.nds} className={removed(cdel) ? "fclass removed" : "fclass"}>
            <header>
              <h3>{c.nds}</h3>
              <span className="muted">↔</span>
              {appInput(ckey, c.app, (app) => ({ args: { driver, "nds-class": c.nds, "app-class": app }, label: `class ${c.nds} ↔ ${app}` }))}
              <span className="spacer" />
              <button className="mini danger" onClick={() => pending.put(cdel, removed(cdel) ? null : { name: "schema-map.remove", args: { driver, "nds-class": c.nds }, label: `unmap class ${c.nds}` })}>
                {removed(cdel) ? "keep" : "remove class"}
              </button>
            </header>
            <table className="defs">
              {head}
              <tbody>{attrRows(c.nds, c.attrs)}</tbody>
            </table>
            {addAttr(c.nds)}
          </section>
        );
      })}
      {map.attrs.length > 0 && (
        <section className="fclass">
          <header>
            <h3>Attributes outside a class</h3>
          </header>
          <table className="defs">
            {head}
            <tbody>{attrRows(null, map.attrs)}</tbody>
          </table>
        </section>
      )}
      {pending.ops
        .filter((o) => o.key?.startsWith("smanew:") || o.key?.startsWith("smcnew:"))
        .map((o) => (
          <p key={o.key} className="changed-line">
            + {o.label}{" "}
            <button className="mini" onClick={() => o.key && pending.put(o.key, null)}>
              undo
            </button>
          </p>
        ))}
      <div className="addrow">
        <strong className="small">New class</strong>
        <input placeholder="eDirectory class" value={newClass.nds} onChange={(e) => setNewClass({ ...newClass, nds: e.target.value })} />
        <input placeholder="application class" value={newClass.app} onChange={(e) => setNewClass({ ...newClass, app: e.target.value })} />
        <button
          disabled={!newClass.nds.trim() || !newClass.app.trim()}
          onClick={() => {
            pending.put(`smcnew:${newClass.nds.trim()}`, { name: "schema-map.set", args: { driver, "nds-class": newClass.nds.trim(), "app-class": newClass.app.trim() }, label: `map class ${newClass.nds.trim()} ↔ ${newClass.app.trim()}` });
            setNewClass({ nds: "", app: "" });
          }}
        >
          Map class
        </button>
      </div>
    </div>
  );
}
