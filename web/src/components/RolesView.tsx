import { useEffect, useState } from "react";
import { api } from "../api";
import { usePending } from "../pending";
import type { CatalogObject, RoleCatalog } from "../types";
import { PendingBar } from "./PendingBar";

/** English text of a localized attribute ("en~Text|de~Text"), for the editor's starting value. */
function english(values: string[] | undefined): string {
  for (const v of values ?? []) {
    for (const part of v.split("|")) {
      if (part.startsWith("en~")) {
        return part.slice(3);
      }
    }
  }
  return "";
}

/**
 * The role and resource catalog of the User Application driver: what exists, and changes to it
 * staged as the core's `role.*` and `resource.*` operations.
 */
export function RolesView({ revision, onSaved }: { revision: string; onSaved: () => void }) {
  const [data, setData] = useState<RoleCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"roles" | "resources">("roles");
  const [role, setRole] = useState({ name: "", level: "10", category: "", display: "", descr: "" });
  const [res, setRes] = useState({ name: "", category: "", display: "", descr: "", entitlement: "" });
  const pending = usePending();

  useEffect(() => {
    let gone = false;
    api
      .roles()
      .then((d) => !gone && (setData(d), setError(null)))
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [revision]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data) {
    return <p className="muted pad">Loading…</p>;
  }
  if (data.drivers.length === 0) {
    return (
      <div className="pad">
        <h2>Roles and resources</h2>
        <p className="muted">No driver in this tree has a provisioning configuration (only the User Application driver does), so there is no catalog.</p>
      </div>
    );
  }
  const driver = data.drivers[0]!;
  const kind = tab === "roles" ? "role" : "resource";
  const rows = tab === "roles" ? data.roles : data.resources;
  const edit = (o: CatalogObject, prop: "display" | "descr", value: string, was: string) =>
    pending.put(`${kind}:${o.path}:${prop}`, value === was ? null : { name: `${kind}.set`, args: { name: o.path, driver: o.driver, [prop]: value }, label: `${kind} ${o.name}: ${prop === "display" ? "display name" : "description"} = ${value}` });
  const staged = (o: CatalogObject, prop: string) => pending.ops.find((p) => p.key === `${kind}:${o.path}:${prop}`)?.args[prop];

  return (
    <div className="view roles">
      <div className="viewhead">
        <div>
          <div className="kicker">{data.drivers.join(", ")}</div>
          <h2>Roles and resources</h2>
        </div>
        <span className="spacer" />
        <div className="tabs">
          <button className={tab === "roles" ? "tab active" : "tab"} onClick={() => setTab("roles")}>
            Roles {data.roles.length}
          </button>
          <button className={tab === "resources" ? "tab active" : "tab"} onClick={() => setTab("resources")} data-testid="roles-tab-resources">
            Resources {data.resources.length}
          </button>
        </div>
      </div>
      <PendingBar pending={pending} title="Review catalog changes" onSaved={onSaved} />
      <div className="pad scroll">
        <table className="grid" data-testid="roles-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>{tab === "roles" ? "Level / category" : "Category"}</th>
              <th>Display name (English)</th>
              <th>Description (English)</th>
              {tab === "resources" && <th>Entitlement</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const display = english(o.attrs.nrfLocalizedNames) || (o.displayName ?? "");
              const descr = english(o.attrs.nrfLocalizedDescrs);
              return (
                <tr key={o.driver + o.path}>
                  <td title={o.path}>
                    <code>{o.name}</code>
                  </td>
                  <td className="muted">{o.container.split("/").slice(2).join(" / ")}</td>
                  <td className="vcell">
                    <input value={staged(o, "display") ?? display} className={pending.has(`${kind}:${o.path}:display`) ? "changed" : ""} onChange={(e) => edit(o, "display", e.target.value, display)} />
                  </td>
                  <td className="vcell">
                    <input value={staged(o, "descr") ?? descr} className={pending.has(`${kind}:${o.path}:descr`) ? "changed" : ""} onChange={(e) => edit(o, "descr", e.target.value, descr)} />
                  </td>
                  {tab === "resources" && <td className="muted small">{(o.attrs.nrfEntitlementRef ?? []).join(" ").replace(/<[^>]+>/g, " ").trim().slice(0, 80) || "—"}</td>}
                  <td className="right">
                    <button onClick={() => pending.add({ name: `${kind}.remove`, args: { name: o.path, driver: o.driver }, label: `remove ${kind} ${o.name}` })}>Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="muted">None yet.</p>}
        {tab === "roles" ? (
          <div className="addrow">
            <strong className="small">New role</strong>
            <input placeholder="name (cn)" value={role.name} onChange={(e) => setRole({ ...role, name: e.target.value })} spellCheck={false} data-testid="role-add-name" />
            <select value={role.level} onChange={(e) => setRole({ ...role, level: e.target.value })}>
              <option value="10">10 permission</option>
              <option value="20">20 IT</option>
              <option value="30">30 business</option>
            </select>
            <input placeholder="category (e.g. Custom)" value={role.category} onChange={(e) => setRole({ ...role, category: e.target.value })} data-testid="role-add-category" />
            <input placeholder="display name" value={role.display} onChange={(e) => setRole({ ...role, display: e.target.value })} />
            <input className="wide" placeholder="description" value={role.descr} onChange={(e) => setRole({ ...role, descr: e.target.value })} />
            <button
              disabled={!role.name || !role.category}
              onClick={() => {
                const args: Record<string, string> = { name: role.name, level: role.level, category: role.category, driver };
                if (role.display) {
                  args.display = role.display;
                }
                if (role.descr) {
                  args.descr = role.descr;
                }
                pending.add({ name: "role.add", args, label: `add role ${role.name} (level ${role.level}, ${role.category})` });
                setRole({ ...role, name: "", display: "", descr: "" });
              }}
              data-testid="role-add"
            >
              Add
            </button>
          </div>
        ) : (
          <div className="addrow">
            <strong className="small">New resource</strong>
            <input placeholder="name (cn)" value={res.name} onChange={(e) => setRes({ ...res, name: e.target.value })} spellCheck={false} />
            <input placeholder="category" value={res.category} onChange={(e) => setRes({ ...res, category: e.target.value })} />
            <input placeholder="display name" value={res.display} onChange={(e) => setRes({ ...res, display: e.target.value })} />
            <input placeholder="description" value={res.descr} onChange={(e) => setRes({ ...res, descr: e.target.value })} />
            <input className="wide" placeholder="entitlement DN (optional)" value={res.entitlement} onChange={(e) => setRes({ ...res, entitlement: e.target.value })} spellCheck={false} />
            <button
              disabled={!res.name || !res.category}
              onClick={() => {
                const args: Record<string, string> = { name: res.name, category: res.category, driver };
                for (const k of ["display", "descr", "entitlement"] as const) {
                  if (res[k]) {
                    args[k] = res[k];
                  }
                }
                pending.add({ name: "resource.add", args, label: `add resource ${res.name} (${res.category})` });
                setRes({ ...res, name: "", display: "", descr: "", entitlement: "" });
              }}
            >
              Add
            </button>
          </div>
        )}
        <p className="muted small">Owners, approvers, quorum, other languages and a resource's entitlement binding change through Operations → {kind}.set.</p>
      </div>
    </div>
  );
}
