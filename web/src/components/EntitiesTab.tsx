import { useState } from "react";
import type { Pending } from "../pending";
import type { EntityAttribute, EntityDef } from "../types";
import { ClassAttributeList } from "./SchemaPickers";

const FLAGS = ["required", "multivalue", "editable", "readable", "searchable", "viewable", "hideable", "enabled"] as const;
const TYPES = ["String", "Integer", "Boolean", "DN", "Time", "Binary", "LocalizedString"];

/**
 * The directory-abstraction entities of the User Application driver: pick one, see and change its
 * attributes — names, type, label, flags — add one, remove one. Every change is an `entity.attr.*`
 * operation, reviewed like the rest.
 */
export function EntitiesTab({ entities, pending }: { entities: EntityDef[]; pending: Pending }) {
  const [picked, setPicked] = useState<string>(entities[0]?.path ?? "");
  const [add, setAdd] = useState({ key: "", ldap: "", type: "String", display: "" });
  const e = entities.find((x) => x.path === picked) ?? entities[0] ?? null;
  if (!e) {
    return <p className="muted pad">No entities: the User Application driver's DirectoryModel/EntityDefs is empty, or there is no such driver. New entities come from the + beside the driver.</p>;
  }
  const k = (a: EntityAttribute, what: string) => `entity:${e.path}:${a.key}:${what}`;
  const staged = (a: EntityAttribute, what: string) => pending.ops.find((o) => o.key === k(a, what))?.args[what];
  const set = (a: EntityAttribute, what: "ldap" | "type" | "display", value: string, was: string) =>
    pending.put(k(a, what), value === was ? null : { name: "entity.attr.set", args: { driver: e.driver, entity: e.key, key: a.key, [what]: value }, label: `${e.key}.${a.key}: ${what} = ${value}` });
  const flag = (a: EntityAttribute, f: string, on: boolean) =>
    pending.put(k(a, f), on === (a.flags[f] ?? false) ? null : { name: "entity.attr.set", args: { driver: e.driver, entity: e.key, key: a.key, [f]: String(on) }, label: `${e.key}.${a.key}: ${f} = ${on}` });
  const flagValue = (a: EntityAttribute, f: string) => {
    const s = staged(a, f);
    return s === undefined ? (a.flags[f] ?? false) : s === "true";
  };
  return (
    <div className="pad scroll" data-testid="entities">
      <div className="addrow">
        <strong className="small">Entity</strong>
        <select value={e.path} onChange={(ev) => setPicked(ev.target.value)} data-testid="entity-pick">
          {entities.map((x) => (
            <option key={x.path} value={x.path}>
              {x.key} — {x.displayName ?? ""} ({x.objectClass ?? "?"})
            </option>
          ))}
        </select>
        <span className="muted small">{e.searchRoot ? `search root ${e.searchRoot}` : ""}</span>
      </div>
      {e.error && <div className="banner error">{e.error}</div>}
      <table className="grid" data-testid="entity-attributes">
        <thead>
          <tr>
            <th>Key</th>
            <th>LDAP name</th>
            <th>Type</th>
            <th>Label</th>
            {FLAGS.map((f) => (
              <th key={f} className="small" title={f}>
                {f.slice(0, 4)}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {e.attributes.map((a) => (
            <tr key={a.key}>
              <td>
                <code>{a.key}</code>
              </td>
              <td className="vcell">
                <input list="entity-ldap-names" value={staged(a, "ldap") ?? a.ldap ?? ""} className={pending.has(k(a, "ldap")) ? "changed" : ""} onChange={(ev) => set(a, "ldap", ev.target.value, a.ldap ?? "")} spellCheck={false} />
              </td>
              <td className="vcell">
                <input list="entity-types" value={staged(a, "type") ?? a.type ?? ""} className={pending.has(k(a, "type")) ? "changed" : ""} onChange={(ev) => set(a, "type", ev.target.value, a.type ?? "")} spellCheck={false} />
              </td>
              <td className="vcell">
                <input value={staged(a, "display") ?? a.display ?? ""} className={pending.has(k(a, "display")) ? "changed" : ""} onChange={(ev) => set(a, "display", ev.target.value, a.display ?? "")} />
              </td>
              {FLAGS.map((f) => (
                <td key={f} className="center">
                  <input type="checkbox" checked={flagValue(a, f)} onChange={(ev) => flag(a, f, ev.target.checked)} title={f} />
                </td>
              ))}
              <td className="right">
                <button onClick={() => pending.put(k(a, "remove"), { name: "entity.attr.remove", args: { driver: e.driver, entity: e.key, key: a.key }, label: `remove attribute ${a.key} from ${e.key}` })}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ClassAttributeList id="entity-ldap-names" className={e.objectClass || null} ldap />
      <datalist id="entity-types">
        {TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {e.attributes.length === 0 && <p className="muted">No attributes yet.</p>}
      <div className="addrow" data-testid="entity-attr-add">
        <input placeholder="key" value={add.key} onChange={(ev) => setAdd({ ...add, key: ev.target.value })} spellCheck={false} />
        <input list="entity-ldap-names" placeholder="LDAP name" value={add.ldap} onChange={(ev) => setAdd({ ...add, ldap: ev.target.value })} spellCheck={false} />
        <input list="entity-types" placeholder="type" value={add.type} onChange={(ev) => setAdd({ ...add, type: ev.target.value })} spellCheck={false} />
        <input placeholder="label (default: the key)" value={add.display} onChange={(ev) => setAdd({ ...add, display: ev.target.value })} />
        <button
          disabled={!add.key.trim() || !add.ldap.trim()}
          onClick={() => {
            const args: Record<string, string> = { driver: e.driver, entity: e.key, key: add.key.trim(), ldap: add.ldap.trim(), type: add.type.trim() || "String" };
            if (add.display.trim()) {
              args.display = add.display.trim();
            }
            pending.add({ name: "entity.attr.add", args, label: `add attribute ${add.key.trim()} (${add.ldap.trim()}, ${args.type}) to ${e.key}` });
            setAdd({ key: "", ldap: "", type: "String", display: "" });
          }}
        >
          Add attribute
        </button>
      </div>
      <p className="muted small">Flags: required, multivalue, editable, readable, searchable, viewable, hideable, enabled. The entity's own display name, search root and flags change through Operations → entity.set.</p>
    </div>
  );
}
