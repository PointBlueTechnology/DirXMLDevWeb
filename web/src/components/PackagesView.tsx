import { useEffect, useState } from "react";
import { api } from "../api";
import { usePending } from "../pending";
import type { BuildResult, CatalogPackage, PackagesData } from "../types";
import { PendingBar } from "./PendingBar";

const LIBRARY = "library";

/**
 * Packages: what each driver and the Library have installed, against the catalog; install,
 * upgrade, uninstall, revert a customized object and adopt records as the core's `package.*`
 * operations through the review; the catalog's packages; a package built from the tree.
 */
export function PackagesView({ drivers, revision, onSaved, onOpen }: { drivers: string[]; revision: string; onSaved: () => void; onOpen: (path: string) => void }) {
  const [data, setData] = useState<PackagesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"installed" | "catalog" | "build">("installed");
  const [install, setInstall] = useState({ target: drivers[0] ?? LIBRARY, pkg: "", version: "" });
  const pending = usePending();

  const load = () => {
    api
      .packages()
      .then((d) => (setData(d), setError(null)))
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, [revision]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data) {
    return <p className="muted pad">Loading…</p>;
  }
  const catalog = data.catalog;
  const targetArgs = (target: string): Record<string, string> => (target === LIBRARY ? {} : { driver: target });
  const chosen = catalog.packages.find((p) => p.short === install.pkg) ?? null;
  const forTarget = (p: CatalogPackage) => (install.target === LIBRARY ? p.type === 3 : p.type !== 3);

  return (
    <div className="view packages">
      <div className="viewhead">
        <div>
          <div className="kicker">{catalog.available ? catalog.dir : "no catalog"}</div>
          <h2>Packages</h2>
        </div>
        <span className="spacer" />
        <div className="tabs">
          <button className={tab === "installed" ? "tab active" : "tab"} onClick={() => setTab("installed")}>
            Installed
          </button>
          <button className={tab === "catalog" ? "tab active" : "tab"} onClick={() => setTab("catalog")} data-testid="pkg-tab-catalog">
            Catalog {catalog.packages.length}
          </button>
          <button className={tab === "build" ? "tab active" : "tab"} onClick={() => setTab("build")} data-testid="pkg-tab-build">
            Build
          </button>
        </div>
      </div>
      <PendingBar pending={pending} title="Review package changes" onSaved={onSaved} />
      {!catalog.available && (
        <div className="banner warn">
          No package catalog: the server was started without <code>--catalog DIR</code> (or <code>IDM_CATALOG</code>). Installed packages are listed from the tree alone; install, upgrade and build need the catalog.
        </div>
      )}

      {tab === "installed" && (
        <div className="pad scroll">
          {data.status.targets.map((t) => (
            <section key={t.name} className="pkgtarget" data-testid={"pkg-target-" + t.name}>
              <h3>{t.name === LIBRARY ? "Library and driver set" : t.name}</h3>
              {t.packages.length === 0 ? (
                <p className="muted small">No packages.</p>
              ) : (
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Package</th>
                      <th>Version</th>
                      <th>Objects</th>
                      <th>Catalog</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {t.packages.map((p) => (
                      <tr key={p.short}>
                        <td>
                          <code>{p.short}</code>
                          {p.base && <span className="pill"> base</span>}
                          {!p.inManifest && (
                            <span className="pill warn" title="The objects carry the package but the manifest has no record">
                              no record
                            </span>
                          )}
                        </td>
                        <td>{p.version ?? "?"}</td>
                        <td>{p.objects}</td>
                        <td className="muted small">{p.inCatalog === null ? (catalog.available ? "not in the catalog" : "") : p.newer ? `newer: ${p.newer}` : "current"}</td>
                        <td className="right">
                          {p.newer && (
                            <button
                              onClick={() => pending.add({ name: "package.upgrade", args: { ...targetArgs(t.name), package: `${p.short}_${p.newer}` }, label: `upgrade ${p.short} to ${p.newer} on ${t.name}` })}
                              data-testid={"pkg-upgrade-" + p.short}
                            >
                              Upgrade to {p.newer}
                            </button>
                          )}{" "}
                          <button onClick={() => pending.add({ name: "package.uninstall", args: { ...targetArgs(t.name), package: p.short }, label: `uninstall ${p.short} from ${t.name}` })}>Uninstall</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {t.customized.length > 0 && (
                <>
                  <p className="small">
                    <strong>Customized packaged objects</strong> — the tree's version differs from the package's:
                  </p>
                  <ul className="filelist">
                    {t.customized.map((c) => (
                      <li key={c} className="dataitem">
                        <button className="link" onClick={() => onOpen(c)}>
                          {c}
                        </button>
                        <button onClick={() => pending.add({ name: "package.revert", args: { path: c }, label: `revert ${c} to its package baseline` })}>Revert</button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {t.notes.map((n, i) => (
                <p key={i} className="muted small">
                  {n}
                  {n.includes("package.adopt") && (
                    <>
                      {" "}
                      <button className="link" onClick={() => pending.put(`adopt:${t.name}`, { name: "package.adopt", args: targetArgs(t.name), label: `write the installed-package records of ${t.name}` })}>
                        Adopt
                      </button>
                    </>
                  )}
                </p>
              ))}
            </section>
          ))}
          {catalog.available && (
            <div className="addrow">
              <strong className="small">Install</strong>
              <select value={install.target} onChange={(e) => setInstall({ target: e.target.value, pkg: "", version: "" })} data-testid="pkg-install-target">
                <option value={LIBRARY}>the Library (driver-set packages)</option>
                {drivers.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <select value={install.pkg} onChange={(e) => setInstall({ ...install, pkg: e.target.value, version: "" })} data-testid="pkg-install-package">
                <option value="">package…</option>
                {catalog.packages.filter(forTarget).map((p) => (
                  <option key={p.short} value={p.short}>
                    {p.short}
                    {p.base ? " (base)" : ""} — {p.displayName ?? ""}
                  </option>
                ))}
              </select>
              {chosen && chosen.versions.length > 1 && (
                <select value={install.version} onChange={(e) => setInstall({ ...install, version: e.target.value })}>
                  <option value="">newest ({chosen.newest})</option>
                  {chosen.versions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
              <button
                disabled={!chosen}
                onClick={() => {
                  const spec = install.version ? `${install.pkg}_${install.version}` : install.pkg;
                  pending.add({ name: "package.install", args: { ...targetArgs(install.target), package: spec }, label: `install ${spec} on ${install.target}` });
                  setInstall({ ...install, pkg: "", version: "" });
                }}
                data-testid="pkg-install"
              >
                Install
              </button>
              <span className="muted small">Packages with prompts take an answers file through Operations → package.install.</span>
            </div>
          )}
        </div>
      )}

      {tab === "catalog" && (
        <div className="pad scroll">
          {!catalog.available ? (
            <p className="muted">No catalog.</p>
          ) : (
            <table className="grid" data-testid="pkg-catalog">
              <thead>
                <tr>
                  <th>Short name</th>
                  <th>Display name</th>
                  <th>Type</th>
                  <th>Versions</th>
                </tr>
              </thead>
              <tbody>
                {catalog.packages.map((p) => (
                  <tr key={p.short}>
                    <td>
                      <code>{p.short}</code>
                      {p.base && <span className="pill"> base</span>}
                    </td>
                    <td>{p.displayName ?? ""}</td>
                    <td className="muted">{p.type === 2 ? "driver" : p.type === 3 ? "driver set" : String(p.type)}</td>
                    <td className="small">{p.versions.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            The catalog is a directory of package jars with an index; <code>idm package.fetch</code> fills it from an update site, <code>package.import</code> from a jar, and Build from this tree.
          </p>
        </div>
      )}

      {tab === "build" && <Build drivers={drivers} catalogAvailable={catalog.available} catalog={catalog.packages} onBuilt={load} />}
    </div>
  );
}

function Build({ drivers, catalogAvailable, catalog, onBuilt }: { drivers: string[]; catalogAvailable: boolean; catalog: CatalogPackage[]; onBuilt: () => void }) {
  const [f, setF] = useState({ driver: drivers[0] ?? "", short: "", name: "", vendor: "", version: "1.0.0", description: "", newVersionOf: "", base: false, customized: "refuse", gcvs: "referenced" });
  const [result, setResult] = useState<BuildResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const build = () => {
    setBusy(true);
    setError(null);
    const req: Record<string, unknown> = { driver: f.driver || null, short: f.short, name: f.name, vendor: f.vendor, version: f.version, description: f.description, base: f.base, customized: f.customized, gcvs: f.gcvs };
    if (f.newVersionOf) {
      req.newVersionOf = f.newVersionOf;
    }
    api
      .buildPackage(req)
      .then((r) => {
        setResult(r);
        if (r.ok) {
          onBuilt();
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="pad scroll">
      <p className="muted small">A package from a driver's (or the Library's) objects that no package owns yet, written into the catalog. Designer can install it from the catalog rendered as an update site.</p>
      <div className="attrs">
        <label className="field">
          <em>From</em>
          <select value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })}>
            <option value="">the Library</option>
            {drivers.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <em>Short name</em>
          <input value={f.short} onChange={(e) => setF({ ...f, short: e.target.value.toUpperCase() })} placeholder="PBCUSTOMAD" spellCheck={false} data-testid="pkg-build-short" />
        </label>
        <label className="field">
          <em>Display name</em>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="pkg-build-name" />
        </label>
        <label className="field">
          <em>Vendor</em>
          <input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} />
        </label>
        <label className="field">
          <em>Version</em>
          <input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} placeholder="1.0.0" />
        </label>
        <label className="field">
          <em>Description</em>
          <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
        <label className="field">
          <em>New version of</em>
          <select value={f.newVersionOf} onChange={(e) => setF({ ...f, newVersionOf: e.target.value })}>
            <option value="">a new package</option>
            {catalog.flatMap((p) => p.versions.map((v) => `${p.short}_${v}`)).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <em>Driver GCVs to ship</em>
          <select value={f.gcvs} onChange={(e) => setF({ ...f, gcvs: e.target.value })}>
            <option value="referenced">the ones the objects reference</option>
            <option value="all">all</option>
            <option value="none">none</option>
          </select>
        </label>
        <label className="checkchip">
          <input type="checkbox" checked={f.base} onChange={(e) => setF({ ...f, base: e.target.checked })} /> base package
        </label>
        <label className="checkchip">
          <input type="checkbox" checked={f.customized === "keep"} onChange={(e) => setF({ ...f, customized: e.target.checked ? "keep" : "refuse" })} /> include customized packaged objects
        </label>
      </div>
      <div className="addrow">
        <button onClick={build} disabled={busy || !catalogAvailable || !f.short || !f.name} data-testid="pkg-build">
          {busy ? "Building…" : "Build into the catalog"}
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {result && (
        <pre className={result.ok ? "outcome" : "outcome err-text"} data-testid="pkg-build-result">
          {result.text}
        </pre>
      )}
    </div>
  );
}
