import { useEffect, useState } from "react";
import { api } from "../api";
import { usePending } from "../pending";
import type { BuildResult, CatalogPackage, FetchResult, PackagesData, SiteListing } from "../types";
import { PendingBar } from "./PendingBar";
import { PromptsForm } from "./PromptsForm";

const LIBRARY = "library";

/**
 * Packages: what each driver and the Library have installed, against the catalog; install,
 * upgrade, uninstall, revert a customized object and adopt records as the core's `package.*`
 * operations through the review; the catalog's packages; a package built from the tree.
 */
export function PackagesView({ drivers, revision, onSaved, onOpen }: { drivers: string[]; revision: string; onSaved: () => void; onOpen: (path: string) => void }) {
  const [data, setData] = useState<PackagesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"installed" | "catalog" | "sites" | "build">("installed");
  const [install, setInstall] = useState({ target: drivers[0] ?? LIBRARY, pkg: "", version: "" });
  const [answers, setAnswers] = useState({ text: "", complete: true });
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
          <div className="kicker">{catalog.available ? `catalog ${catalog.dir}` : "installed packages from the tree · no catalog on this server"}</div>
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
          <button className={tab === "sites" ? "tab active" : "tab"} onClick={() => setTab("sites")} data-testid="pkg-tab-sites">
            Update sites
          </button>
          <button className={tab === "build" ? "tab active" : "tab"} onClick={() => setTab("build")} data-testid="pkg-tab-build">
            Build
          </button>
        </div>
      </div>
      <PendingBar pending={pending} title="Review package changes" onSaved={onSaved} />
      {!catalog.available && (
        <div className="banner">
          The installed packages below are read from the tree (each object's package stamp). This server has no package catalog, so there is nothing to install, upgrade or fetch from: start it with <code>--catalog DIR</code> (local) or set <code>catalog.dir</code> (hosted) and the Update sites tab fills it.
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
                disabled={!chosen || !answers.complete}
                onClick={() => {
                  const spec = install.version ? `${install.pkg}_${install.version}` : install.pkg;
                  pending.add({ name: "package.install", args: { ...targetArgs(install.target), package: spec }, files: answers.text ? { answers: answers.text } : undefined, label: `install ${spec} on ${install.target}` });
                  setInstall({ ...install, pkg: "", version: "" });
                  setAnswers({ text: "", complete: true });
                }}
                data-testid="pkg-install"
              >
                Install
              </button>
            </div>
          )}
          {catalog.available && chosen?.hasPrompts && (
            <div className="pad-x">
              <PromptsForm key={install.pkg + install.version} packages={install.version ? `${install.pkg}_${install.version}` : install.pkg} driver={install.target === LIBRARY ? undefined : install.target} onChange={(text, complete) => setAnswers({ text, complete })} />
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
          {catalog.available && <ImportJar onImported={load} />}
          <p className="muted small">
            The catalog is a directory of package jars with an index; Update sites fills it from a package repository (<code>idm package.fetch</code>), a jar from your disk is imported above, and Build adds one from this tree.
          </p>
        </div>
      )}

      {tab === "sites" && <Sites catalogAvailable={catalog.available} installed={new Set(data.status.targets.flatMap((t) => t.packages.map((p) => p.short)))} onFetched={load} />}
      {tab === "build" && <Build drivers={drivers} catalogAvailable={catalog.available} catalog={catalog.packages} onBuilt={load} />}
    </div>
  );
}

/** A package jar from the person's disk into the catalog (`package.import`). */
function ImportJar({ onImported }: { onImported: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="addrow" data-testid="pkg-import">
      <strong className="small">Import a jar</strong>
      <input
        type="file"
        accept=".jar,application/java-archive"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) {
            return;
          }
          setBusy(true);
          setError(null);
          setResult(null);
          api
            .importPackage(f)
            .then((r) => {
              setResult(r.ok ? (r.added ? `added ${r.short}_${r.version}` : `${r.short}_${r.version} was already in the catalog`) : (r.refusal ?? "refused"));
              if (r.ok) {
                onImported();
              }
            })
            .catch((err: Error) => setError(err.message))
            .finally(() => {
              setBusy(false);
              e.target.value = "";
            });
        }}
        data-testid="pkg-import-file"
      />
      {busy && <span className="muted small">Importing…</span>}
      {result && <span className="small">{result}</span>}
      {error && <span className="err-text small">{error}</span>}
    </div>
  );
}

const CUSTOM = "custom";

/**
 * Package repositories (Designer's update sites, from the catalog's sites.properties, or any URL):
 * what one offers against the catalog, fetched in by package — or every newer version of what the
 * tree has installed — so the Installed tab can offer the upgrade.
 */
function Sites({ catalogAvailable, installed, onFetched }: { catalogAvailable: boolean; installed: Set<string>; onFetched: () => void }) {
  const [sites, setSites] = useState<{ name: string; url: string }[]>([]);
  const [site, setSite] = useState("");
  const [custom, setCustom] = useState("");
  const [listing, setListing] = useState<SiteListing | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .packageSites()
      .then((s) => {
        setSites(s.sites);
        setSite((cur) => cur || s.sites[0]?.url || CUSTOM);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  const url = site === CUSTOM ? custom.trim() : site;
  const browse = () => {
    setBusy("browse");
    setError(null);
    setResult(null);
    api
      .packageSite(url)
      .then((l) => {
        setListing(l);
        setPicked([]);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  const fetch = (specs: string[], what: string) => {
    setBusy(what);
    setError(null);
    api
      .fetchPackages({ site: url, packages: specs })
      .then((r) => {
        setResult(r);
        setPicked([]);
        onFetched();
        // the listing's "in catalog" column follows
        return api.packageSite(url).then(setListing);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  const updates = listing?.packages.filter((p) => installed.has(p.short) && p.newer) ?? [];
  const toggle = (s: string) => setPicked(picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s]);
  return (
    <div className="pad scroll" data-testid="pkg-sites">
      <p className="muted small">A package repository is an Eclipse update site (Designer's, or one rendered from another catalog with <code>package.site</code>). Fetching puts the jar in this catalog — installing or upgrading on a driver is reviewed on the Installed tab.</p>
      {!catalogAvailable && <div className="banner error">No catalog on this server: start it with --catalog DIR (or IDM_CATALOG) to fetch packages.</div>}
      <div className="addrow">
        <select value={site} onChange={(e) => setSite(e.target.value)} data-testid="pkg-site">
          {sites.map((s) => (
            <option key={s.name} value={s.url}>
              {s.name} — {s.url}
            </option>
          ))}
          <option value={CUSTOM}>another URL…</option>
        </select>
        {site === CUSTOM && <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="https://host/path/to/updatesite/" spellCheck={false} data-testid="pkg-site-url" />}
        <button onClick={browse} disabled={!catalogAvailable || !url || busy !== null} data-testid="pkg-site-browse">
          {busy === "browse" ? "Reading…" : "Browse"}
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {listing && !listing.ok && <div className="banner error">Could not read the site: {listing.error}</div>}
      {listing && listing.ok && (
        <>
          <div className="addrow">
            <button className="primary" disabled={picked.length === 0 || busy !== null} onClick={() => fetch(picked, "picked")} data-testid="pkg-fetch-picked">
              {busy === "picked" ? "Fetching…" : `Fetch selected (${picked.length})`}
            </button>
            <button disabled={updates.length === 0 || busy !== null} onClick={() => fetch(updates.map((p) => p.short), "updates")} title="Every installed package the site has a newer version of" data-testid="pkg-fetch-updates">
              {busy === "updates" ? "Fetching…" : `Fetch updates for installed packages (${updates.length})`}
            </button>
            <span className="muted small">{listing.packages.length} packages on the site</span>
          </div>
          <table className="grid" data-testid="pkg-site-listing">
            <thead>
              <tr>
                <th />
                <th>Short name</th>
                <th>Display name</th>
                <th>Newest on the site</th>
                <th>In the catalog</th>
                <th>Installed</th>
              </tr>
            </thead>
            <tbody>
              {listing.packages.map((p) => (
                <tr key={p.short} className={p.newer ? "newer" : ""}>
                  <td>
                    <input type="checkbox" checked={picked.includes(p.short)} onChange={() => toggle(p.short)} />
                  </td>
                  <td>
                    <code>{p.short}</code>
                  </td>
                  <td>{p.displayName ?? ""}</td>
                  <td className="small">
                    {p.newest}
                    {p.versions.length > 1 && <span className="muted"> (+{p.versions.length - 1} older)</span>}
                  </td>
                  <td className="small">{p.inCatalog.length === 0 ? <span className="muted">—</span> : p.newer ? <span className="warn-text">{p.inCatalog.join(", ")} — site is newer</span> : p.inCatalog.join(", ")}</td>
                  <td className="small">{installed.has(p.short) ? "yes" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {result && (
        <div className={result.ok ? "banner" : "banner error"} data-testid="pkg-fetch-result">
          {result.error && <div>{result.error}</div>}
          {result.added.length > 0 && <div>Added: {result.added.join(", ")}</div>}
          {result.skipped.length > 0 && <div className="muted">Already in the catalog: {result.skipped.join(", ")}</div>}
          {result.refused.length > 0 && <div className="warn-text">Refused: {result.refused.join("; ")}</div>}
        </div>
      )}
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
