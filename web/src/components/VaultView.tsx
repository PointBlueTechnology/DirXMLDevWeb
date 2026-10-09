import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { EnvPicker, useEnvironment } from "../env";
import { CachePanel } from "./CachePanel";
import { EventsView } from "./EventsView";
import { TraceViewer } from "./TraceViewer";
import type { DeployResult, Outline, Selection, VaultDiffResult, VaultStatus, VaultSnapshot, DriverAssociations, ObjectInspection, PasswordSync } from "../types";

type Tab = "compare" | "drivers" | "objects" | "trace" | "events";

/**
 * The tree against a vault: what differs, a deploy planned and run, the drivers' state and
 * control, a driver's live trace. The environments are the ones the `idm` CLI knows; a write
 * to a vault happens only after the person types that environment's name.
 */
export function VaultView({ drivers, revision, outline, onOpen, onSelect, onSaved }: { drivers: string[]; revision: string; outline: Outline | null; onOpen: (path: string) => void; onSelect: (s: Selection) => void; onSaved: () => void }) {
  const { envs, env, setEnv, why } = useEnvironment();
  const [tab, setTab] = useState<Tab>("compare");

  if (!envs) {
    return <p className="muted pad">Loading…</p>;
  }
  if (envs.length === 0) {
    return (
      <div className="pad">
        <h1>Vault</h1>
        <p>No environments are configured, so there is no vault to compare with.</p>
        <p className="muted">{why ?? "The environments file names none."}</p>
        <p>
          <button className="primary" onClick={() => onSelect({ type: "connections" })} data-testid="vault-setup">
            Set up a connection
          </button>
        </p>
        <p className="muted small">
          Environments are the file the <code>idm</code> CLI reads: <code>IDM_ENVIRONMENTS</code>, <code>./environments.properties</code> or <code>~/.idm/environments.properties</code>.
        </p>
      </div>
    );
  }
  const chosen = envs.find((e) => e.name === env) ?? null;

  return (
    <div className="view vault">
      <div className="viewhead">
        <h2>Vault</h2>
        <label className="field">
          <em>Environment</em>
          <EnvPicker envs={envs} env={env} setEnv={setEnv} testid="vault-env" />
        </label>
        {chosen && <span className={chosen.tier === "prod" ? "pill err" : "pill"}>{chosen.tier}</span>}
        {chosen?.hasOverrides && <span className="pill ok" title="overrides/<env>.properties is applied to the tree before it is compared or deployed">overrides</span>}
        <button className="link" onClick={() => onSelect({ type: "connections", env: chosen?.name })} title="Connection parameters, password and driver secrets">
          {chosen ? "Connection and secrets" : "Connections"}
        </button>
        <span className="spacer" />
        <div className="tabs">
          {(["compare", "drivers", "objects", "trace", "events"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)} data-testid={"vault-tab-" + t}>
              {t === "compare" ? "Compare & deploy" : t === "drivers" ? "Drivers" : t === "objects" ? "Objects" : t === "trace" ? "Trace" : "Events"}
            </button>
          ))}
        </div>
      </div>
      {!chosen ? (
        <p className="muted pad">Choose an environment. Nothing is read from a vault until you ask.</p>
      ) : tab === "compare" ? (
        <Compare key={chosen.name} env={chosen.name} drivers={drivers} revision={revision} onOpen={onOpen} onFix={() => onSelect({ type: "connections", env: chosen.name })} />
      ) : tab === "drivers" ? (
        <Drivers key={chosen.name} env={chosen.name} onFix={() => onSelect({ type: "connections", env: chosen.name })} onSelect={onSelect} onSaved={onSaved} />
      ) : tab === "objects" ? (
        <Objects key={chosen.name} env={chosen.name} />
      ) : (
        tab === "trace" ? (
        <TraceViewer key={chosen.name} env={chosen.name} drivers={drivers} outline={outline} onSelect={onSelect} onOpen={onOpen} />
      ) : (
        <EventsView key={chosen.name} env={chosen.name} outline={outline} drivers={drivers} onSelect={onSelect} onOpen={onOpen} onSaved={onSaved} />
      )
      )}
    </div>
  );
}

function Confirm({ env, value, onChange }: { env: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field confirm">
      <em>
        Type <code>{env}</code> to allow writes
      </em>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={env} spellCheck={false} autoComplete="off" data-testid="vault-confirm" />
    </label>
  );
}

/** An error from a vault call, with a way to the connection when it looks like one. */
function VaultError({ message, onFix }: { message: string; onFix: () => void }) {
  const connection = /connect |password|authentication|bind|environment '|secrets?/i.test(message);
  return (
    <div className="banner error">
      {message}
      {connection && (
        <>
          {" "}
          <button className="link" onClick={onFix} data-testid="vault-fix">
            Fix the connection or credentials
          </button>
        </>
      )}
    </div>
  );
}

function Compare({ env, drivers, revision, onOpen, onFix }: { env: string; drivers: string[]; revision: string; onOpen: (path: string) => void; onFix: () => void }) {
  const [only, setOnly] = useState<string>("");
  const [restart, setRestart] = useState(true);
  const [secrets, setSecrets] = useState<"none" | "missing" | "all">("none");
  const [allowMissing, setAllowMissing] = useState(false);
  const [deleteDrivers, setDeleteDrivers] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<VaultSnapshot[] | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [rollbackOf, setRollbackOf] = useState<VaultSnapshot | null>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState("");
  const [rollbackResult, setRollbackResult] = useState<DeployResult | null>(null);
  const choices = { restart, secrets, allowMissingSecrets: allowMissing, deleteDrivers };
  const loadSnapshots = () =>
    api.vault
      .snapshots(env)
      .then((r) => setSnapshots(r.snapshots))
      .catch((e: Error) => setError(e.message));
  const rollback = () =>
    act("Rolling back…", async () => {
      if (!rollbackOf) {
        return;
      }
      const r = await api.vault.rollback(env, rollbackOf.file, rollbackConfirm, rollbackOf.server);
      setRollbackResult(r);
      setRollbackConfirm("");
      if (r.ok) {
        setRollbackOf(null);
        setDiff(null);
        setPlan(null);
        setResult(null);
        void loadSnapshots();
      }
    });
  const [diff, setDiff] = useState<VaultDiffResult | null>(null);
  const [comparedAt, setComparedAt] = useState("");
  const [plan, setPlan] = useState<DeployResult | null>(null);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const scope = only ? [only] : [];
  const stale = diff !== null && comparedAt !== revision;

  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const compare = () =>
    act("Comparing…", async () => {
      setPlan(null);
      setResult(null);
      setDiff(await api.vault.diff(env, scope));
      setComparedAt(revision);
    });
  const makePlan = () =>
    act("Planning…", async () => {
      setResult(null);
      setPlan(await api.vault.plan(env, scope, choices));
    });
  const deploy = () =>
    act("Deploying…", async () => {
      const r = await api.vault.deploy(env, scope, choices, confirm);
      setResult(r);
      setConfirm("");
      if (r.ok) {
        setPlan(null);
        setDiff(await api.vault.diff(env, scope));
        setComparedAt(revision);
      }
    });

  return (
    <div className="pad">
      <div className="addrow">
        <label className="field">
          <em>Scope</em>
          <select value={only} onChange={(e) => (setOnly(e.target.value), setDiff(null), setPlan(null), setResult(null))}>
            <option value="">the whole driver set</option>
            {drivers.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <button onClick={compare} disabled={busy !== null} data-testid="vault-compare">
          Compare
        </button>
        {busy && <span className="muted">{busy}</span>}
      </div>
      {error && <VaultError message={error} onFix={onFix} />}
      {stale && <div className="banner warn">The tree changed since this comparison. Compare again before deploying.</div>}
      {diff && (
        <>
          {diff.overrides && <p className="muted small">{diff.overrides}</p>}
          {diff.empty ? (
            <p className="ok-text" data-testid="vault-same">
              The vault matches the tree. Nothing to deploy.
            </p>
          ) : (
            <>
              <p>
                {diff.changes.length} difference{diff.changes.length === 1 ? "" : "s"}
                {diff.affectedDrivers.length > 0 && <> · drivers affected: {diff.affectedDrivers.join(", ")}</>}
              </p>
              <table className="grid" data-testid="vault-changes">
                <thead>
                  <tr>
                    <th>Change</th>
                    <th>Driver</th>
                    <th>Where</th>
                    <th>What a deploy does</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.changes.map((c, i) => (
                    <Fragment key={i}>
                      <tr className={c.detail ? "clickable" : ""} onClick={() => c.detail && setOpenRow(openRow === i ? null : i)}>
                        <td>
                          <span className={"badge st-" + badge(c.kind)}>{badge(c.kind)}</span> {subject(c.kind)}
                          {c.what ? ` ${c.what}` : ""}
                        </td>
                        <td>{c.driver ?? "—"}</td>
                        <td>
                          <button
                            className="link"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpen(c.path);
                            }}
                          >
                            {c.path}
                          </button>
                        </td>
                        <td>{c.summary}</td>
                      </tr>
                      {openRow === i && c.detail && (
                        <tr>
                          <td colSpan={4}>
                            <DiffText text={c.detail} env={env} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {diff.changes.some((c) => c.kind.toUpperCase() === "DRIVER_REMOVED" && c.driver) && (
                <div className="block" data-testid="vault-delete-drivers">
                  <h4>Drivers only in the vault</h4>
                  <p className="muted small">A deploy leaves them alone unless asked. Tick one to delete its whole subtree from {env}; it must be stopped, the plan refuses otherwise; the snapshot captures it first, so a rollback brings it back.</p>
                  {diff.changes
                    .filter((c) => c.kind.toUpperCase() === "DRIVER_REMOVED" && c.driver)
                    .map((c) => (
                      <label key={c.driver} className="checkchip">
                        <input type="checkbox" checked={deleteDrivers.includes(c.driver!)} onChange={(e) => (setDeleteDrivers(e.target.checked ? [...deleteDrivers, c.driver!] : deleteDrivers.filter((d) => d !== c.driver)), setPlan(null))} data-testid={"vault-delete-" + c.driver} /> delete {c.driver} from the vault
                      </label>
                    ))}
                </div>
              )}
              <div className="addrow">
                <label className="checkchip">
                  <input type="checkbox" checked={restart} onChange={(e) => (setRestart(e.target.checked), setPlan(null))} /> restart the drivers a change needs restarted
                </label>
                <label className="field">
                  <em>Secrets</em>
                  <select value={secrets} onChange={(e) => (setSecrets(e.target.value as "none" | "missing" | "all"), setPlan(null))} title="A driver's shim, Remote Loader and named passwords, from the environment's secrets file: left alone on an update unless asked" data-testid="vault-secrets">
                    <option value="none">leave alone (set on a first deploy only)</option>
                    <option value="missing">set named passwords the vault lacks</option>
                    <option value="all">re-set every provided secret (a rotated password)</option>
                  </select>
                </label>
                <label className="checkchip" title="A first deploy of a driver refuses when a secret it needs is not provided; allow it to create the driver stopped and list what to set">
                  <input type="checkbox" checked={allowMissing} onChange={(e) => (setAllowMissing(e.target.checked), setPlan(null))} data-testid="vault-allow-missing" /> allow missing secrets on a first deploy
                </label>
                <button onClick={makePlan} disabled={busy !== null || stale} data-testid="vault-plan">
                  Plan the deploy
                </button>
              </div>
            </>
          )}
        </>
      )}
      {plan && (
        <div className="block">
          <h4>Plan (nothing written yet)</h4>
          {plan.refusal && <div className="banner error">{plan.refusal}</div>}
          <pre className="outcome" data-testid="vault-plan-text">
            {plan.plan ?? plan.text}
          </pre>
          {plan.ok && !plan.refusal && (
            <div className="addrow">
              <Confirm env={env} value={confirm} onChange={setConfirm} />
              <button className="danger" onClick={deploy} disabled={busy !== null || confirm !== env || stale} data-testid="vault-deploy">
                Deploy to {env}
              </button>
              <span className="muted small">A snapshot of the vault is taken first; the result is verified by comparing again.</span>
            </div>
          )}
        </div>
      )}
      {result && (
        <div className="block">
          <h4 className={result.ok ? "ok-text" : "err-text"}>{result.ok ? "Deployed" : result.refusal ? "Refused" : "Failed"}</h4>
          <pre className="outcome" data-testid="vault-result">
            {result.refusal ?? result.text}
          </pre>
          {result.snapshot && (
            <p className="muted small">
              Snapshot: <code>{result.snapshot}</code>{" "}
              <button className="link" onClick={() => (setRollbackOf({ file: result.snapshot!, name: result.snapshot!.replace(/^.*\//, ""), server: null, bytes: 0, ok: true }), setRollbackResult(null))} data-testid="vault-rollback-last">
                Roll back to it…
              </button>
            </p>
          )}
        </div>
      )}
      <div className="block">
        <div className="addrow tight">
          <h4 style={{ margin: 0 }}>Snapshots</h4>
          <span className="muted small">taken before every deploy and every rollback; a rollback puts one back and snapshots the current state first</span>
          <span className="spacer" />
          <button onClick={() => (setShowSnapshots(!showSnapshots), !showSnapshots && void loadSnapshots())} data-testid="vault-snapshots">
            {showSnapshots ? "Hide" : "Show"}
          </button>
        </div>
        {showSnapshots && snapshots && snapshots.length === 0 && <p className="muted small">No snapshots of {env} yet.</p>}
        {showSnapshots && snapshots && snapshots.length > 0 && (
          <table className="grid" data-testid="vault-snapshots-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Label</th>
                <th>By</th>
                <th>Objects</th>
                <th>Drivers</th>
                <th>Server</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {snapshots.map((sn) => (
                <tr key={sn.file} className={rollbackOf?.file === sn.file ? "selected" : ""}>
                  <td className="small">
                    <code>{sn.timestamp ?? sn.name}</code>
                    {sn.treeCommit && <div className="muted small">tree {sn.treeCommit.slice(0, 8)}</div>}
                  </td>
                  <td className="small">{sn.ok ? (sn.label ?? "—") : <span className="err-text">{sn.message}</span>}</td>
                  <td className="small">{sn.user ?? "—"}</td>
                  <td>{sn.objects ?? "—"}</td>
                  <td>{sn.drivers ?? "—"}</td>
                  <td className="small">{sn.server ?? "—"}</td>
                  <td className="right">
                    <button disabled={!sn.ok || busy !== null} onClick={() => (setRollbackOf(sn), setRollbackResult(null))} data-testid={"vault-rollback-" + sn.name}>
                      Roll back…
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rollbackOf && (
          <div className="block" data-testid="vault-rollback">
            <h4>Roll {env} back to {rollbackOf.name}</h4>
            <p className="small">Every object in the snapshot is put back as it was — attributes a deploy added are removed, objects it deleted are re-added, objects it added are deleted — and the drivers that were running then are restarted. The current state is snapshotted first, so this is reversible; the result is verified against the snapshot.</p>
            <div className="addrow">
              <Confirm env={env} value={rollbackConfirm} onChange={setRollbackConfirm} />
              <button className="danger" onClick={rollback} disabled={busy !== null || rollbackConfirm !== env} data-testid="vault-rollback-go">
                Roll back
              </button>
              <button onClick={() => setRollbackOf(null)} disabled={busy !== null}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {rollbackResult && (
          <div className="block">
            <h4 className={rollbackResult.ok ? "ok-text" : "err-text"}>{rollbackResult.ok ? "Rolled back" : rollbackResult.refusal ? "Refused" : "Failed"}</h4>
            <pre className="outcome" data-testid="vault-rollback-result">
              {rollbackResult.refusal ?? rollbackResult.text}
            </pre>
            {rollbackResult.snapshot && (
              <p className="muted small">
                The state before this rollback: <code>{rollbackResult.snapshot}</code>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A change kind is SUBJECT_VERB (DRIVER_ADDED, CONFIG_CHANGED): the verb picks the badge. */
function badge(kind: string): string {
  const k = kind.toUpperCase();
  return k.endsWith("ADDED") ? "added" : k.endsWith("REMOVED") || k.endsWith("DELETED") ? "deleted" : "changed";
}

function subject(kind: string): string {
  return kind
    .replace(/_(ADDED|REMOVED|DELETED|CHANGED)$/i, "")
    .toLowerCase()
    .replace(/_/g, " ");
}

function Drivers({ env, onFix, onSelect, onSaved }: { env: string; onFix: () => void; onSelect: (s: Selection) => void; onSaved: () => void }) {
  const [cacheOf, setCacheOf] = useState<string | null>(null);
  const [assocOf, setAssocOf] = useState<string | null>(null);
  const [startOpts, setStartOpts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    setBusy("Reading…");
    api.vault
      .status(env)
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  useEffect(load, [env]);

  const act = (driver: string, action: string) => {
    setBusy(`${action} ${driver}…`);
    setLast(null);
    api.vault
      .driver(env, driver, action, confirm)
      .then((r) => {
        setLast({ ok: r.ok, text: r.text });
        return api.vault.status(env).then(setStatus);
      })
      .catch((e: Error) => setLast({ ok: false, text: e.message }))
      .finally(() => setBusy(null));
  };
  const setStartOption = (driver: string, option: "auto" | "manual" | "disabled") => {
    setBusy("Setting the start option…");
    api.vault
      .startOption(env, driver, option, confirm)
      .then((r) => (setLast({ ok: r.ok, text: r.text }), load()))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  const armed = confirm === env;
  const [levels, setLevels] = useState<Record<string, number>>({});
  const setLevel = (driver: string, level: number) => {
    setBusy(`trace level ${level} on ${driver}…`);
    setLast(null);
    api.vault
      .traceLevel(env, driver, level, confirm)
      .then((r) => {
        setLast({ ok: r.ok, text: r.text });
        return api.vault.status(env).then(setStatus);
      })
      .catch((e: Error) => setLast({ ok: false, text: e.message }))
      .finally(() => setBusy(null));
  };

  return (
    <div className="pad">
      <div className="addrow">
        <button onClick={load} disabled={busy !== null}>
          Refresh
        </button>
        <Confirm env={env} value={confirm} onChange={setConfirm} />
        {busy && <span className="muted">{busy}</span>}
      </div>
      {error && <VaultError message={error} onFix={onFix} />}
      {last && <pre className={last.ok ? "outcome" : "outcome err-text"}>{last.text}</pre>}
      {status && (
        <table className="grid" data-testid="vault-drivers">
          <thead>
            <tr>
              <th>Driver</th>
              <th>State</th>
              <th>Start option</th>
              <th>Cache</th>
              <th>Trace level</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {status.drivers.map((d) => (
              <tr key={d.dn}>
                <td title={d.dn}>{d.name}</td>
                <td>
                  <span className={d.state === "running" ? "pill ok" : d.state === "stopped" ? "pill" : "pill warn"}>{d.state}</span>
                </td>
                <td className="nowrap">
                  <select value={startOpts[d.name] ?? d.startOption} onChange={(e) => setStartOpts({ ...startOpts, [d.name]: e.target.value })} disabled={!armed || busy !== null} title="DirXML-DriverStartOption, set live (driver.start-option); the tree's own value wins at the next deploy" data-testid={"start-option-" + d.name}>
                    {["auto", "manual", "disabled"].map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                    {!["auto", "manual", "disabled"].includes(startOpts[d.name] ?? d.startOption) && <option value={d.startOption}>{d.startOption}</option>}
                  </select>{" "}
                  <button className="mini" disabled={!armed || busy !== null || (startOpts[d.name] ?? d.startOption) === d.startOption} onClick={() => setStartOption(d.name, startOpts[d.name] as "auto" | "manual" | "disabled")} title="Write the start option on the driver (driver.start-option)">
                    Set
                  </button>{" "}
                  <button className="mini" onClick={() => setAssocOf(assocOf === d.name ? null : d.name)} title="The objects associated with the driver, by state, and its password-sync settings" data-testid={"assoc-view-" + d.name}>
                    {assocOf === d.name ? "hide" : "objects"}
                  </button>
                </td>
                <td className="nowrap">
                  {d.cacheSize ?? ""}{" "}
                  <button className="mini" onClick={() => setCacheOf(cacheOf === d.name ? null : d.name)} title="The queued events: view them, save them as a simulator case, clear the cache" data-testid={"cache-view-" + d.name}>
                    {cacheOf === d.name ? "hide" : "view"}
                  </button>
                </td>
                <td className="tracelevel" data-testid={"trace-level-" + d.name}>
                  <select value={(levels[d.name] ?? Number(d.traceLevel ?? 0))} onChange={(e) => setLevels({ ...levels, [d.name]: Number(e.target.value) })} disabled={!armed || busy !== null} title="DirXML-TraceLevel, kept per server; 0 is off, 3 shows policy results, 5 and above every document">
                    {Array.from({ length: 11 }, (_, i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </select>{" "}
                  <button className="mini" disabled={!armed || busy !== null || ((levels[d.name] ?? Number(d.traceLevel ?? 0))) === Number(d.traceLevel ?? 0)} onClick={() => setLevel(d.name, (levels[d.name] ?? Number(d.traceLevel ?? 0)))} title="Write the level on the environment's server (driver.trace set)">
                    Set
                  </button>
                </td>
                <td className="right">
                  <button disabled={!armed || busy !== null || d.state === "running"} onClick={() => act(d.name, "start")}>
                    Start
                  </button>{" "}
                  <button disabled={!armed || busy !== null || d.state === "stopped"} onClick={() => act(d.name, "stop")}>
                    Stop
                  </button>{" "}
                  <button disabled={!armed || busy !== null} onClick={() => act(d.name, "restart")}>
                    Restart
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {assocOf && <AssociationsPanel key={assocOf} env={env} driver={assocOf} onClose={() => setAssocOf(null)} />}
      {cacheOf && <CachePanel key={cacheOf} env={env} driver={cacheOf} armed={armed} confirm={confirm} deployer onClose={() => setCacheOf(null)} onSaved={onSaved} onSimulator={() => onSelect({ type: "simulator" })} />}
    </div>
  );
}

/** A driver's associated objects by state (the console's driver inspector) and its password-sync settings. */
function AssociationsPanel({ env, driver, onClose }: { env: string; driver: string; onClose: () => void }) {
  const [state, setState] = useState("");
  const [data, setData] = useState<DriverAssociations | null>(null);
  const [sync, setSync] = useState<PasswordSync | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(true);
    setError(null);
    Promise.all([api.vault.associations(env, driver, state || undefined), sync ? Promise.resolve(sync) : api.vault.passwordSync(env, driver)])
      .then(([a, p]) => (setData(a), setSync(p)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, driver, state]);
  return (
    <section className="block" data-testid="assoc-panel">
      <div className="addrow tight">
        <h4 style={{ margin: 0 }}>{driver}: associated objects</h4>
        <select value={state} onChange={(e) => setState(e.target.value)} data-testid="assoc-state">
          <option value="">every state</option>
          {["processed", "pending", "manual", "disabled", "migrate"].map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
        {busy && <span className="muted small">reading…</span>}
        <span className="spacer" />
        <button onClick={onClose}>Close</button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {data && (
        <>
          <p className="small">
            {Object.entries(data.counts).map(([st, n]) => (
              <span key={st} className={"pill " + (st === "processed" ? "ok" : n > 0 && (st === "pending" || st === "disabled") ? "warn" : "")} style={{ marginRight: 6 }}>
                {st} {n}
              </span>
            ))}
            <span className="muted">
              {data.total} object{data.total === 1 ? "" : "s"}
              {data.listed < data.total ? `, first ${data.listed} listed` : ""}
            </span>
          </p>
          {data.objects.length > 0 && (
            <table className="grid" data-testid="assoc-table">
              <thead>
                <tr>
                  <th>State</th>
                  <th>Object</th>
                  <th>Association value</th>
                </tr>
              </thead>
              <tbody>
                {data.objects.map((o) => (
                  <tr key={o.dn + o.state}>
                    <td>{o.state}</td>
                    <td className="small">
                      <code>{o.dn}</code>
                    </td>
                    <td className="small">
                      <code>{o.value}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {sync && (
        <div style={{ marginTop: 10 }}>
          <h4>Password sync</h4>
          <p className="muted small">Driver set timeout: {sync.driverSetTimeout ? `${sync.driverSetTimeout} min` : "not set (the engine's default)"}.</p>
          {sync.settings.length > 0 ? (
            <table className="grid">
              <thead>
                <tr>
                  <th>Setting (live)</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {sync.settings.map((st) => (
                  <tr key={st.name}>
                    <td>
                      <code>{st.name}</code>
                    </td>
                    <td>{st.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">No password-related settings in the driver's live configuration.</p>
          )}
        </div>
      )}
    </section>
  );
}

/** One object as the vault has it (the console's object inspector): classes, associations across drivers, password-sync status. */
function Objects({ env }: { env: string }) {
  const [dn, setDn] = useState("");
  const [data, setData] = useState<ObjectInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const look = () => {
    setBusy(true);
    setError(null);
    api.vault
      .inspect(env, dn)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="pad">
      <div className="addrow">
        <input className="wide" value={dn} onChange={(e) => setDn(e.target.value)} placeholder="cn=jdoe,ou=users,o=data" spellCheck={false} onKeyDown={(e) => e.key === "Enter" && dn && look()} data-testid="inspect-dn" />
        <button onClick={look} disabled={!dn || busy} data-testid="inspect-go">
          {busy ? "Reading…" : "Inspect"}
        </button>
        <span className="muted small">What state the object is in on each driver, and its password-sync status; a read of {env}.</span>
      </div>
      {error && <div className="banner error">{error}</div>}
      {data && !data.ok && <div className="banner error">{data.error ?? data.text}</div>}
      {data && data.ok && (
        <div className="block" data-testid="inspect-result">
          <h4>
            <code>{data.dn}</code>
          </h4>
          <p className="small muted">{(data.objectClass ?? []).join(", ")}</p>
          <h4>Associations</h4>
          {(data.associations ?? []).length === 0 ? (
            <p className="muted small">None: no driver has associated this object.</p>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>State</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {(data.associations ?? []).map((a, i) => (
                  <tr key={i}>
                    <td>{a.driver ?? a.raw}</td>
                    <td>{a.state ? <span className={"pill " + (a.state === "processed" ? "ok" : a.state === "pending" || a.state === "disabled" ? "warn" : "")}>{a.state}</span> : ""}</td>
                    <td className="small">
                      <code>{a.value ?? ""}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h4>Password sync</h4>
          {(data.passwordSync ?? []).length === 0 ? (
            <p className="muted small">No status recorded on the object.</p>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>When</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(data.passwordSync ?? []).map((p, i) => (
                  <tr key={i}>
                    <td>{p.driver}</td>
                    <td className="small">{p.time}</td>
                    <td>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A change's unified text with its sides named: the core diffs the vault against the tree, so a
 * "−" line is what the vault holds now and a "+" line is what the tree holds — and what a deploy
 * writes. Each line is coloured by side.
 */
function DiffText({ text, env }: { text: string; env: string }) {
  const lines = text.split("\n");
  return (
    <div className="difftext" data-testid="diff-text">
      <div className="difflegend small">
        <span className="diffside vault">− in the vault ({env}) now</span>
        <span className="diffside tree">+ in the tree — what a deploy writes</span>
      </div>
      <pre className="outcome">
        {lines.map((l, i) => (
          <span key={i} className={l.startsWith("-") && !l.startsWith("---") ? "diffline vault" : l.startsWith("+") && !l.startsWith("+++") ? "diffline tree" : "diffline"}>
            {l}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}

