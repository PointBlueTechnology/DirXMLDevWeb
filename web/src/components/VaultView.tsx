import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { TraceViewer } from "./TraceViewer";
import type { DeployResult, Selection, VaultDiffResult, VaultEnvironments, VaultStatus } from "../types";

type Tab = "compare" | "drivers" | "trace";

/**
 * The tree against a vault: what differs, a deploy planned and run, the drivers' state and
 * control, a driver's live trace. The environments are the ones the `idm` CLI knows; a write
 * to a vault happens only after the person types that environment's name.
 */
export function VaultView({ drivers, revision, onOpen, onSelect }: { drivers: string[]; revision: string; onOpen: (path: string) => void; onSelect: (s: Selection) => void }) {
  const [envs, setEnvs] = useState<VaultEnvironments | null>(null);
  const [env, setEnv] = useState("");
  const [tab, setTab] = useState<Tab>("compare");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.vault
      .environments()
      .then((e) => {
        setEnvs(e);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!envs) {
    return <p className="muted pad">Loading…</p>;
  }
  if (!envs.available || envs.environments.length === 0) {
    return (
      <div className="pad">
        <h1>Vault</h1>
        <p>No environments are configured, so there is no vault to compare with.</p>
        <p className="muted">{envs.why ?? "The environments file names none."}</p>
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
  const chosen = envs.environments.find((e) => e.name === env) ?? null;

  return (
    <div className="view vault">
      <div className="viewhead">
        <h2>Vault</h2>
        <label className="field">
          <em>Environment</em>
          <select value={env} onChange={(e) => setEnv(e.target.value)} data-testid="vault-env">
            <option value="">choose…</option>
            {envs.environments.map((e) => (
              <option key={e.name} value={e.name} disabled={!e.ready}>
                {e.name} ({e.tier}){e.ready ? "" : " — incomplete"}
              </option>
            ))}
          </select>
        </label>
        {chosen && <span className={chosen.tier === "prod" ? "pill err" : "pill"}>{chosen.tier}</span>}
        {chosen?.hasOverrides && <span className="pill ok" title="overrides/<env>.properties is applied to the tree before it is compared or deployed">overrides</span>}
        <button className="link" onClick={() => onSelect({ type: "connections", env: chosen?.name })} title="Connection parameters, password and driver secrets">
          {chosen ? "Connection and secrets" : "Connections"}
        </button>
        <span className="spacer" />
        <div className="tabs">
          {(["compare", "drivers", "trace"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {t === "compare" ? "Compare & deploy" : t === "drivers" ? "Drivers" : "Trace"}
            </button>
          ))}
        </div>
      </div>
      {!chosen ? (
        <p className="muted pad">Choose an environment. Nothing is read from a vault until you ask.</p>
      ) : tab === "compare" ? (
        <Compare key={chosen.name} env={chosen.name} drivers={drivers} revision={revision} onOpen={onOpen} onFix={() => onSelect({ type: "connections", env: chosen.name })} />
      ) : tab === "drivers" ? (
        <Drivers key={chosen.name} env={chosen.name} onFix={() => onSelect({ type: "connections", env: chosen.name })} />
      ) : (
        <TraceViewer key={chosen.name} env={chosen.name} drivers={drivers} />
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
      setPlan(await api.vault.plan(env, scope, restart));
    });
  const deploy = () =>
    act("Deploying…", async () => {
      const r = await api.vault.deploy(env, scope, restart, confirm);
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
                            <pre className="outcome">{c.detail}</pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <div className="addrow">
                <label className="checkchip">
                  <input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} /> restart the drivers a change needs restarted
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
              Snapshot: <code>{result.snapshot}</code> (roll back with <code>idm vault.rollback</code>)
            </p>
          )}
        </div>
      )}
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

function Drivers({ env, onFix }: { env: string; onFix: () => void }) {
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
                <td>{d.startOption}</td>
                <td>{d.cacheSize ?? ""}</td>
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
    </div>
  );
}
