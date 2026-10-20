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
  // "not yet": deployed to the others, planned for the missing one; "never": that environment doesn't get it, for good
  const notDeployedTo = (driver: string, missing: string, later: boolean) => {
    pending.put(`env:${driver}`, {
      name: "driver.set",
      args: { driver, key: "environments", value: envs.filter((e) => e !== missing).join(", ") },
      label: later ? `${driver}: not yet in ${missing}` : `${driver}: never in ${missing}`,
    });
    pending.put(`planned:${driver}`, later ? { name: "driver.set", args: { driver, key: "planned", value: missing }, label: `${driver}: planned for ${missing}` } : null);
  };
  const unexpected = result ? result.onlyIn.filter((o) => !o.expected && !o.planned).length + result.values.filter((v) => !v.expected).length + (result.drift?.changes.length ?? 0) : 0;
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
              <h4>Only one of them holds</h4>
              <table className="grid" data-testid="env-compare-only">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th>Only in</th>
                    <th>The tree</th>
                  </tr>
                </thead>
                <tbody>
                  {result.onlyIn
                    .filter((o) => o.kind === "driver")
                    .map((o) => {
                      const missing = o.env === result.a ? result.b : result.a;
                      const driver = o.driver ?? "";
                      return (
                        <tr key={o.env + ":" + o.path}>
                          <td>{driver}</td>
                          <td>{o.env}</td>
                          <td>
                            {o.planned ? (
                              <span className="pill small">planned for {missing}</span>
                            ) : o.expected ? (
                              <span className="pill small">expected</span>
                            ) : o.notInTree ? (
                              <span className="small">
                                not in the tree. Bring it in with <em>Update this branch from {o.env}…</em> on Compare &amp; deploy; it comes marked as {o.env}&apos;s only.
                              </span>
                            ) : (
                              <span className="addrow tight">
                                <button onClick={() => notDeployedTo(driver, missing, true)} disabled={pending.has(`env:${driver}`)} title={`Promote to ${missing} later`} data-testid={"env-not-yet-" + driver}>
                                  Not yet in {missing}
                                </button>
                                <button onClick={() => notDeployedTo(driver, missing, false)} disabled={pending.has(`env:${driver}`)} title={`${o.env}'s own, for good`} data-testid={"env-never-" + driver}>
                                  Never in {missing}
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {groups(result).map((g) => (
                <details key={g.key} className="small">
                  <summary>
                    {g.count} {g.kind}
                    {g.count === 1 ? "" : g.kind.endsWith("y") ? "" : "s"} only in {g.env}
                    {g.expected > 0 && ` · ${g.expected} expected`}
                    {g.planned > 0 && ` · ${g.planned} planned`}
                    {g.notInTree > 0 && ` · ${g.notInTree} not in the tree`}
                  </summary>
                  <ul className="plain">
                    {g.items.map((o) => (
                      <li key={o.path}>
                        <code>{o.path}</code> {o.planned ? <span className="pill small">planned</span> : o.expected ? <span className="pill small">expected</span> : o.notInTree ? <span className="muted">not in the tree</span> : null}
                      </li>
                    ))}
                  </ul>
                  {g.notInTree > 0 && (
                    <p className="muted">
                      <em>Update this branch from {g.env}…</em> brings the ones not in the tree in, marked as {g.env}&apos;s only.
                    </p>
                  )}
                </details>
              ))}
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
            <section className="block" data-testid="env-compare-drift">
              <h4>Other differences, which no value explains</h4>
              <p className="muted small">
                Policies, filters, linkage, packages. An override can&apos;t carry these. Each has a likely cause, worked out from the change; open a driver to see its changes and
                decide. When {result.b} is right, nothing to record in the tree: a deploy to {result.a} brings it in line. When {result.a} has the newer work, bring it into a branch
                with <em>Update this branch from {result.a}…</em>, ticking those files.
              </p>
              {byDriver(result).map((g) => (
                <details key={g.driver} className="drift-driver">
                  <summary>
                    <strong>{g.driver}</strong> <span className="muted small">{g.changes.length} difference{g.changes.length === 1 ? "" : "s"}: {Object.entries(g.causes).map(([c, n]) => `${n} ${c}`).join(", ")}</span>
                  </summary>
                  <table className="grid small">
                    <thead>
                      <tr>
                        <th>Change</th>
                        <th>Likely cause</th>
                        <th>Suggests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.changes.map(({ change, cause }, i) => (
                        <tr key={i}>
                          <td>
                            <button className="link" onClick={() => onOpen(change.path)} title={change.path}>
                              {change.summary}
                            </button>
                          </td>
                          <td>{cause}</td>
                          <td className="muted">{suggest(cause, result.a, result.b)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ))}
            </section>
          )}
          {(result.caseOnly ?? []).length > 0 && (
            <p className="muted small">{result.caseOnly!.length} more differ only in letter case (eDirectory reads those DNs as the same); left out.</p>
          )}
        </>
      )}
    </div>
  );
}

/** The one-sided entitlement policies, templates and jobs, by kind and environment. */
function groups(result: EnvCompareResult) {
  const out: { key: string; kind: string; env: string; count: number; expected: number; planned: number; notInTree: number; items: EnvCompareResult["onlyIn"] }[] = [];
  for (const o of result.onlyIn.filter((x) => x.kind !== "driver")) {
    const key = o.kind + ":" + o.env;
    let g = out.find((x) => x.key === key);
    if (!g) {
      g = { key, kind: o.kind, env: o.env, count: 0, expected: 0, planned: 0, notInTree: 0, items: [] };
      out.push(g);
    }
    g.count++;
    g.expected += o.expected && !o.planned ? 1 : 0;
    g.planned += o.planned ? 1 : 0;
    g.notInTree += o.notInTree ? 1 : 0;
    g.items.push(o);
  }
  return out;
}

/** The drift by driver (the driver set's own under "driver set"), most differences first, with counts by likely cause. */
function byDriver(result: EnvCompareResult) {
  const out = new Map<string, { driver: string; changes: { change: EnvCompareResult["drift"] extends infer D ? (D extends { changes: (infer C)[] } ? C : never) : never; cause: string }[]; causes: Record<string, number> }>();
  (result.drift?.changes ?? []).forEach((change, i) => {
    const driver = change.driver ?? "driver set";
    const cause = result.causes?.[i] ?? "both changed";
    let g = out.get(driver);
    if (!g) {
      g = { driver, changes: [], causes: {} };
      out.set(driver, g);
    }
    g.changes.push({ change, cause });
    g.causes[cause] = (g.causes[cause] ?? 0) + 1;
  });
  return [...out.values()].sort((x, y) => y.changes.length - x.changes.length);
}

/** What a likely cause suggests doing, in a few words. */
function suggest(cause: string, a: string, b: string): string {
  if (cause === `only in ${b}` || cause === `lines only ${b} has`) {
    return `${a} lacks it: bring ${a} in line, or keep it as intended`;
  }
  if (cause === `only in ${a}` || cause === `lines only ${a} has`) {
    return `${b} lacks it: promote it to ${b}, drop it from ${a}, or keep it as intended`;
  }
  if (cause === "package versions differ") {
    return "the newer package wins; check which side has it";
  }
  if (cause === "cosmetic") {
    return "align either way";
  }
  if (cause === "environment-specific text") {
    return "a name typed into content: move it into a GCV, then override it";
  }
  return "both sides changed: review";
}
