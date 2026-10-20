import { useEffect, useState } from "react";
import { api } from "../api";
import { usePending } from "../pending";
import type { EnvCompareResult } from "../types";
import { PendingBar } from "./PendingBar";

/**
 * Two environments' vaults side by side: the drivers only one of them holds, the values that differ, and what else
 * differs once the values are set aside (policies, filters, linkage). What the tree already accounts for is marked
 * expected: a driver it doesn't deploy to the other environment, a value an environment's override sets. The rest can
 * be recorded from here (an override for either environment, "not deployed to" on a driver) as reviewed changes to
 * the tree; nothing is written to either vault.
 */
export function EnvironmentsCompare({ env, envs, onOpen, onSaved }: { env: string; envs: string[]; onOpen: (path: string) => void; onSaved: () => void }) {
  const others = envs.filter((e) => e !== env);
  const [other, setOther] = useState(others[0] ?? "");
  const [result, setResult] = useState<EnvCompareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [since, setSince] = useState(0);
  const [now, setNow] = useState(0);
  const pending = usePending();
  useEffect(() => {
    if (!busy) {
      return;
    }
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [busy]);
  const run = () => {
    setBusy(true);
    setError(null);
    setSince(Date.now());
    setNow(Date.now());
    api.vault
      .compareEnvs(env, other)
      .then(setResult)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  if (others.length === 0) {
    return <p className="muted pad">This project has one environment. Add another under Connections to compare them.</p>;
  }
  const record = (forEnv: string, key: string, value: string | null) =>
    pending.put(`ovr:${forEnv}:${key}`, { name: "override.set", args: { env: forEnv, key, value: value ?? "" }, label: `${forEnv}: ${key} = ${value ?? ""}` });
  const staged = (forEnv: string, key: string) => pending.has(`ovr:${forEnv}:${key}`);
  const notDeployedTo = (driver: string, missing: string) =>
    pending.put(`env:${driver}`, {
      name: "driver.set",
      args: { driver, key: "environments", value: envs.filter((e) => e !== missing).join(", ") },
      label: `${driver}: not deployed to ${missing}`,
    });
  const unexpected = result ? result.onlyIn.filter((o) => !o.expected).length + result.values.filter((v) => !v.expected).length + (result.drift?.changes.length ?? 0) : 0;
  return (
    <div className="pad" data-testid="env-compare">
      <PendingBar pending={pending} title={`Record what comparing ${env} with ${result?.b ?? other} found`} onSaved={onSaved} />
      <div className="addrow">
        <span>
          Compare <strong>{env}</strong> with
        </span>
        <select value={other} onChange={(e) => (setOther(e.target.value), setResult(null))} data-testid="env-compare-other">
          {others.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <button className="primary" onClick={run} disabled={busy || !other} data-testid="env-compare-run">
          Compare
        </button>
        {busy && (
          <span className="busy-line muted">
            <span className="spinner" /> Reading {env} and {other}… {Math.max(0, Math.round((now - since) / 1000))}s
          </span>
        )}
      </div>
      <p className="muted small">
        Reads both vaults; nothing is written to either. Marked <span className="pill small">expected</span>: what the tree already says, a driver it doesn&apos;t deploy to the
        other environment or a value an environment&apos;s override sets. Record the rest from here, as changes to the tree you review and save.
      </p>
      {error && <div className="banner error">{error}</div>}
      {result && (
        <>
          {result.notes.length > 0 && (
            <div className="banner warn">
              <ul className="plain small">
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <p data-testid="env-compare-summary">
            {result.onlyIn.length + result.values.length + (result.drift?.changes.length ?? 0) === 0
              ? `${result.a} and ${result.b} hold the same configuration.`
              : `${unexpected} difference${unexpected === 1 ? "" : "s"} the tree doesn't account for yet.`}
          </p>

          {result.onlyIn.length > 0 && (
            <section className="block">
              <h4>Drivers only one of them holds</h4>
              <table className="grid" data-testid="env-compare-only">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th>Only in</th>
                    <th>The tree</th>
                  </tr>
                </thead>
                <tbody>
                  {result.onlyIn.map((o) => {
                    const missing = o.env === result.a ? result.b : result.a;
                    return (
                      <tr key={o.env + ":" + o.driver}>
                        <td>{o.driver}</td>
                        <td>{o.env}</td>
                        <td>
                          {o.expected ? (
                            <span className="pill small">expected</span>
                          ) : o.notInTree ? (
                            <span className="small">
                              not in the tree. Bring it in with <em>Update this branch from {o.env}…</em> on Compare &amp; deploy; it comes marked as {o.env}&apos;s only.
                            </span>
                          ) : (
                            <button onClick={() => notDeployedTo(o.driver, missing)} disabled={pending.has(`env:${o.driver}`)} data-testid={"env-not-deployed-" + o.driver}>
                              Not deployed to {missing}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {result.values.length > 0 && (
            <section className="block">
              <h4>Values that differ</h4>
              <table className="grid" data-testid="env-compare-values">
                <thead>
                  <tr>
                    <th>Value</th>
                    <th>{result.a}</th>
                    <th>{result.b}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {result.values.map((v) => (
                    <tr key={v.key}>
                      <td>
                        <code className="small">{v.key}</code>
                      </td>
                      <td className="small">{v.a ?? <span className="muted">(none)</span>}</td>
                      <td className="small">{v.b ?? <span className="muted">(none)</span>}</td>
                      <td>
                        {v.expected ? (
                          <span className="pill small">expected</span>
                        ) : (
                          <span className="addrow tight">
                            <button onClick={() => record(result.b, v.key, v.b)} disabled={staged(result.b, v.key) || staged(result.a, v.key)} title={`overrides/${result.b}.properties`}>
                              {result.b}&apos;s override
                            </button>
                            <button onClick={() => record(result.a, v.key, v.a)} disabled={staged(result.b, v.key) || staged(result.a, v.key)} title={`overrides/${result.a}.properties`}>
                              {result.a}&apos;s override
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {result.drift && result.drift.changes.length > 0 && (
            <section className="block">
              <h4>Other differences, which no value explains</h4>
              <p className="muted small">
                Policies, filters, linkage, definitions one side lacks. An override can&apos;t carry these: one of the two environments has work the other hasn&apos;t had, or has drifted.
                Bring {result.b}&apos;s into a branch with <em>Update this branch from {result.b}…</em>, ticking the files you want.
              </p>
              <table className="grid" data-testid="env-compare-drift">
                <thead>
                  <tr>
                    <th>Change</th>
                    <th>Driver</th>
                    <th>Where</th>
                  </tr>
                </thead>
                <tbody>
                  {result.drift.changes.map((c, i) => (
                    <tr key={i}>
                      <td>{c.summary}</td>
                      <td>{c.driver ?? "driver set"}</td>
                      <td>
                        <button className="link" onClick={() => onOpen(c.path)}>
                          {c.path}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
