import { useEffect, useState } from "react";
import { api } from "../api";
import { usePending } from "../pending";
import type { CatalogObject, Category, RoleCatalog } from "../types";
import { PendingBar } from "./PendingBar";
import { EntitiesTab as Entities } from "./EntitiesTab";

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

type Pending = ReturnType<typeof usePending>;

/**
 * A role's or resource's category keys as a picker over the list (core #70). Choosing stages
 * `role.set`/`resource.set --category`, which replaces the keys; a key the list lacks is shown as such.
 */
function CategoryCell({ o, kind, cats, pending }: { o: CatalogObject; kind: "role" | "resource"; cats: Category[] | null; pending: Pending }) {
  const keys = o.attrs[kind === "role" ? "nrfRoleCategoryKey" : "nrfCategoryKey"] ?? [];
  const current = keys.join(",");
  const pkey = `${kind}:${o.path}:category`;
  const value = pending.ops.find((p) => p.key === pkey)?.args.category ?? current;
  if (!cats) {
    return <td className="muted">{keys.join(", ") || "—"}</td>;
  }
  const known = cats.some((c) => c.key === value);
  const unknown = keys.filter((k) => !cats.some((c) => c.key === k));
  return (
    <td className="vcell">
      <select
        value={value}
        className={pending.has(pkey) ? "changed" : unknown.length ? "warn" : ""}
        title={unknown.length ? `not in the category list: ${unknown.join(", ")}` : undefined}
        onChange={(e) => pending.put(pkey, e.target.value === current ? null : { name: `${kind}.set`, args: { name: o.path, driver: o.driver, category: e.target.value }, label: `${kind} ${o.name}: category = ${e.target.value}` })}
        data-testid="category-cell"
      >
        {!known && <option value={value}>{value ? keys.map((k) => cats.find((c) => c.key === k)?.label ?? `${k} (not in the list)`).join(", ") : "—"}</option>}
        {cats.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
    </td>
  );
}

/** The role and resource category lists: labels edited in place, keys added and removed (core `category.*`). */
function CategoriesTab({ driver, lists, pending }: { driver: string; lists: { role: Category[] | null; resource: Category[] | null } | undefined; pending: Pending }) {
  const [add, setAdd] = useState({ for: "role", key: "", label: "" });
  if (!lists) {
    return <p className="muted pad">This version of DirXMLDev does not report the category lists.</p>;
  }
  const section = (f: "role" | "resource") => {
    const cats = lists[f];
    return (
      <div key={f}>
        <h3>{f === "role" ? "Role categories" : "Resource categories"}</h3>
        {cats === null ? (
          <p className="muted small">The tree has no DirectoryModel/ChoiceDefs/{f}s-category (import-live adopts it).</p>
        ) : (
          <table className="grid" data-testid={`categories-${f}`}>
            <thead>
              <tr>
                <th>Key</th>
                <th>Label (English)</th>
                <th>Other languages</th>
                <th>Used by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => {
                const pkey = `category:${f}:${c.key}:label`;
                const was = c.labels.en ?? "";
                const value = pending.ops.find((p) => p.key === pkey)?.args.display ?? was;
                return (
                  <tr key={c.key}>
                    <td>
                      <code>{c.key}</code>
                    </td>
                    <td className="vcell">
                      <input
                        value={value}
                        className={pending.has(pkey) ? "changed" : ""}
                        onChange={(e) => pending.put(pkey, e.target.value === was || !e.target.value ? null : { name: "category.set", args: { for: f, key: c.key, display: e.target.value, driver }, label: `${f} category ${c.key}: label = ${e.target.value}` })}
                      />
                    </td>
                    <td className="muted small">{Object.keys(c.labels).filter((l) => l !== "en").join(" ") || "—"}</td>
                    <td className="muted">{c.used ? `${c.used} ${f}${c.used === 1 ? "" : "s"}` : "—"}</td>
                    <td className="right">
                      <button disabled={c.used > 0} title={c.used > 0 ? `still used by ${c.used} ${f}${c.used === 1 ? "" : "s"}` : undefined} onClick={() => pending.add({ name: "category.remove", args: { for: f, key: c.key, driver }, label: `remove ${f} category ${c.key}` })}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    );
  };
  return (
    <div className="pad scroll">
      {section("role")}
      {section("resource")}
      <div className="addrow">
        <strong className="small">New category</strong>
        <select value={add.for} onChange={(e) => setAdd({ ...add, for: e.target.value })}>
          <option value="role">role</option>
          <option value="resource">resource</option>
        </select>
        <input placeholder="key (e.g. sales)" value={add.key} onChange={(e) => setAdd({ ...add, key: e.target.value })} spellCheck={false} data-testid="category-add-key" />
        <input className="wide" placeholder="label (English; default: the key)" value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} />
        <button
          disabled={!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(add.key)}
          onClick={() => {
            const args: Record<string, string> = { for: add.for, key: add.key, driver };
            if (add.label) {
              args.display = add.label;
            }
            pending.add({ name: "category.add", args, label: `add ${add.for} category ${add.key}` });
            setAdd({ ...add, key: "", label: "" });
          }}
          data-testid="category-add"
        >
          Add
        </button>
      </div>
      <p className="muted small">A category is a key of the Directory Abstraction Layer's list, separate from the container a role or resource sits in. Labels in other languages change through Operations → category.set.</p>
    </div>
  );
}

/**
 * The role and resource catalog of the User Application driver: what exists, and changes to it
 * staged as the core's `role.*` and `resource.*` operations.
 */
export function RolesView({ revision, onSaved }: { revision: string; onSaved: () => void }) {
  const [data, setData] = useState<RoleCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"roles" | "resources" | "entities" | "categories">("roles");
  const [role, setRole] = useState({ name: "", level: "10", container: "", category: "", display: "", descr: "" });
  const [res, setRes] = useState({ name: "", container: "", category: "", display: "", descr: "", entitlement: "" });
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
  const lists = data.categories?.[driver];
  const cats = (tab === "roles" ? lists?.role : lists?.resource) ?? null;
  const picker = (value: string, set: (v: string) => void, testid: string) =>
    cats ? (
      <select value={value} onChange={(e) => set(e.target.value)} data-testid={testid}>
        <option value="">category…</option>
        {cats.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
    ) : (
      <input placeholder="category key" value={value} onChange={(e) => set(e.target.value)} spellCheck={false} data-testid={testid} />
    );
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
          <button className={tab === "entities" ? "tab active" : "tab"} onClick={() => setTab("entities")} data-testid="roles-tab-entities">
            Entities {data.entities?.length ?? 0}
          </button>
          <button className={tab === "categories" ? "tab active" : "tab"} onClick={() => setTab("categories")} data-testid="roles-tab-categories">
            Categories
          </button>
        </div>
      </div>
      <PendingBar pending={pending} title="Review catalog changes" onSaved={onSaved} />
      {tab === "entities" && <Entities entities={data.entities ?? []} pending={pending} />}
      {tab === "categories" && <CategoriesTab driver={driver} lists={lists} pending={pending} />}
      <div className="pad scroll" style={tab === "entities" || tab === "categories" ? { display: "none" } : undefined}>
        <table className="grid" data-testid="roles-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>{tab === "roles" ? "Level / container" : "Container"}</th>
              <th>Category</th>
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
                  <CategoryCell o={o} kind={kind} cats={cats} pending={pending} />
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
            <input placeholder="container (default: the category)" value={role.container} onChange={(e) => setRole({ ...role, container: e.target.value })} spellCheck={false} data-testid="role-add-container" />
            {picker(role.category, (v) => setRole({ ...role, category: v }), "role-add-category")}
            <input placeholder="display name" value={role.display} onChange={(e) => setRole({ ...role, display: e.target.value })} />
            <input className="wide" placeholder="description" value={role.descr} onChange={(e) => setRole({ ...role, descr: e.target.value })} />
            <button
              disabled={!role.name || !role.category}
              onClick={() => {
                const args: Record<string, string> = { name: role.name, level: role.level, category: role.category, driver };
                if (role.container) {
                  args.container = role.container;
                }
                if (role.display) {
                  args.display = role.display;
                }
                if (role.descr) {
                  args.descr = role.descr;
                }
                pending.add({ name: "role.add", args, label: `add role ${role.name} (level ${role.level}, ${role.container || role.category}, category ${role.category})` });
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
            <input placeholder="container (default: the category)" value={res.container} onChange={(e) => setRes({ ...res, container: e.target.value })} spellCheck={false} />
            {picker(res.category, (v) => setRes({ ...res, category: v }), "resource-add-category")}
            <input placeholder="display name" value={res.display} onChange={(e) => setRes({ ...res, display: e.target.value })} />
            <input placeholder="description" value={res.descr} onChange={(e) => setRes({ ...res, descr: e.target.value })} />
            <input className="wide" placeholder="entitlement DN (optional)" value={res.entitlement} onChange={(e) => setRes({ ...res, entitlement: e.target.value })} spellCheck={false} />
            <button
              disabled={!res.name || !res.category}
              onClick={() => {
                const args: Record<string, string> = { name: res.name, category: res.category, driver };
                for (const k of ["container", "display", "descr", "entitlement"] as const) {
                  if (res[k]) {
                    args[k] = res[k];
                  }
                }
                pending.add({ name: "resource.add", args, label: `add resource ${res.name} (${res.container || res.category}, category ${res.category})` });
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
