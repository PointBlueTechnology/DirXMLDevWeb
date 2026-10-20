import { useEffect, useState } from "react";
import { api } from "../api";
import { usePending } from "../pending";
import type { EnvCompareResult, VaultChange } from "../types";
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
  // proposals someone said no to, for this comparison
  const [dismissed, setDismissed] = useState<string[]>([]);
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

          {serverSides(result).map((side) => (
            <section className="block" key={side.env} data-testid={"env-servers-" + side.env}>
              <h4>{side.env}&apos;s servers</h4>
              <p className="muted small">
                Server names are unique to a tree, so {side.env} runs the tree&apos;s drivers on servers of its own. Pick the {side.env} server each tree server stands for (several onto
                one where {side.env} has fewer). Recorded in <code>overrides/{side.env}.properties</code>; compare, plan and deploy then use them.
              </p>
              <table className="grid small">
                <thead>
                  <tr>
                    <th>The tree&apos;s server</th>
                    <th>{side.env}&apos;s server</th>
                  </tr>
                </thead>
                <tbody>
                  {side.tree.map((t, i) => {
                    // the file splits a line at its first "=", so a key names the server by its name, never its DN
                    const name = side.names[i];
                    const key = `ovr:${side.env}:servers.${name}`;
                    const staged = pending.ops.find((o) => o.key === key);
                    const current = staged ? String(staged.args.value ?? "") : side.map[t] ?? "";
                    return (
                      <tr key={t}>
                        <td>
                          <code>{t}</code>
                        </td>
                        <td>
                          <select
                            value={current}
                            onChange={(e) =>
                              pending.put(key, e.target.value === (side.map[t] ?? "") ? null : { name: "override.set", args: { env: side.env, key: `servers.${name}`, value: e.target.value }, label: `${side.env}: ${name} → ${e.target.value}` })
                            }
                            className={staged ? "changed" : ""}
                            data-testid={`env-server-${side.env}-${i}`}
                          >
                            <option value="">(not mapped)</option>
                            {side.own.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}

          {(result.matches ?? []).filter((m) => !dismissed.includes(m.a + "|" + m.b)).length > 0 && (
            <section className="block" data-testid="env-compare-matches">
              <h4>Likely the same driver under another name</h4>
              <p className="muted small">
                Same shim, a similar name, policies in common. Nothing is matched until you say so: <em>Same driver</em> records the other environment&apos;s name for the tree&apos;s
                driver (<code>drivers/&lt;driver&gt;.name</code> in that environment&apos;s overrides).
              </p>
              <ul className="plain">
                {(result.matches ?? [])
                  .filter((m) => !dismissed.includes(m.a + "|" + m.b))
                  .map((m) => {
                    const inTree = (env: string, driver: string) => result.onlyIn.some((o) => o.kind === "driver" && o.env === env && o.driver === driver && !o.notInTree);
                    // the tree holds one of the two names; the other environment's name is recorded for it
                    const rec = inTree(result.a, m.a) ? { env: result.b, tree: m.a, there: m.b } : inTree(result.b, m.b) ? { env: result.a, tree: m.b, there: m.a } : null;
                    const key = rec ? `ovr:${rec.env}:drivers/${rec.tree}.name` : "";
                    return (
                      <li key={m.a + "|" + m.b} className="match">
                        {result.a}&apos;s <strong>{m.a}</strong> and {result.b}&apos;s <strong>{m.b}</strong>{" "}
                        <span className="muted small">
                          ({m.common} of {m.of} policies in common)
                        </span>{" "}
                        {m.feed && (
                          <span className="small warn-text">
                            Their names carry an environment&apos;s name: perhaps the two ends, or one role, of a feed between environments. One tree driver named per environment, or a
                            driver of each environment&apos;s own?
                          </span>
                        )}{" "}
                        {rec ? (
                          <>
                            <button
                              onClick={() => pending.put(key, { name: "override.set", args: { env: rec.env, key: `drivers/${rec.tree}.name`, value: rec.there }, label: `${rec.env}: ${rec.tree} is called ${rec.there} there` })}
                              disabled={pending.has(key)}
                              data-testid={"env-match-" + m.a}
                            >
                              {m.feed ? "One driver, named per environment" : "Same driver"}
                            </button>{" "}
                            <button onClick={() => setDismissed([...dismissed, m.a + "|" + m.b])}>{m.feed ? "Different drivers" : "Not the same"}</button>
                          </>
                        ) : (
                          <span className="muted small">Neither is in the tree yet: bring one in first (Update this branch from …).</span>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </section>
          )}

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
                  {(() => {
                    const open = g.items.filter((o) => !o.expected && !o.planned && !o.notInTree);
                    if (open.length === 0) {
                      return null;
                    }
                    const missing = g.env === result.a ? result.b : result.a;
                    const others = envs.filter((e) => e !== missing).join(", ");
                    const paths = open.map((o) => o.path).join("\n");
                    const key = `envobj:${g.key}`;
                    return (
                      <p className="addrow tight">
                        <button
                          onClick={() => pending.put(key, { name: "environments.set", args: { paths, environments: others, "no-plan": "true" }, label: `${open.length} ${g.kind}(s): not in ${missing}, for good` })}
                          disabled={pending.has(key)}
                          data-testid={"env-objects-own-" + g.key}
                        >
                          {open.length === g.count ? "These" : `The ${open.length} in the tree`}: {g.env}&apos;s own
                        </button>
                        <button
                          onClick={() => pending.put(key, { name: "environments.set", args: { paths, environments: others, planned: missing }, label: `${open.length} ${g.kind}(s): planned for ${missing}` })}
                          disabled={pending.has(key)}
                        >
                          Planned for {missing}
                        </button>
                      </p>
                    );
                  })()}
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
                decide. Where the tree is right, nothing to record: a deploy to the other environment brings it in line. Where an environment has newer work, bring it into a branch
                with <em>Update this branch from …</em> on Compare &amp; deploy, ticking those files.
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
                        <th>Accept as it is</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.changes.map(({ change, cause, fingerprint }, i) => {
                        const key = `known:${change.path}`;
                        const accept = (decision: "intended" | "later") => {
                          const note = window.prompt(decision === "intended" ? "Why is it different on purpose? (optional)" : "What needs deciding? (optional)") ?? "";
                          pending.put(key, {
                            name: "known.accept",
                            args: { env: result.a, with: result.b, path: change.path, fingerprint, decision, summary: change.summary, ...(note.trim() ? { note: note.trim() } : {}) },
                            label: `${decision === "intended" ? "accepted" : "to decide"}: ${change.summary}`,
                          });
                        };
                        return (
                          <tr key={i}>
                            <td>
                              <button className="link" onClick={() => onOpen(change.path)} title={change.path}>
                                {change.summary}
                              </button>
                              {(result.changedSinceAccepted ?? []).includes(change.path) && <span className="pill small warn"> changed since accepted</span>}
                            </td>
                            <td>{cause}</td>
                            <td className="muted">{suggest(cause, result.a, result.b)}</td>
                            <td className="nowrap">
                              {pending.has(key) ? (
                                <span className="pill small">staged</span>
                              ) : (
                                <>
                                  <button className="link small" onClick={() => accept("intended")} title="Different on purpose: comparisons leave it out while it stays the same">
                                    on purpose
                                  </button>{" "}
                                  <button className="link small" onClick={() => accept("later")} title="To decide: comparisons leave it out, listed under accepted">
                                    later
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </details>
              ))}
            </section>
          )}
          {(result.accepted ?? []).length > 0 && (
            <details className="block small" data-testid="env-compare-accepted">
              <summary>
                {result.accepted!.length} accepted as known ({result.accepted!.filter((k) => k.decision === "later").length} to decide), unchanged since
              </summary>
              <table className="grid small">
                <tbody>
                  {result.accepted!.map((k) => (
                    <tr key={k.path + k.with}>
                      <td>{k.summary}</td>
                      <td>{k.decision === "later" ? "to decide" : "on purpose"}</td>
                      <td className="muted">{k.note ?? ""}</td>
                      <td className="muted">
                        {k.by} {k.at?.slice(0, 10)}
                      </td>
                      <td>
                        <button
                          className="link"
                          onClick={() => pending.put(`forget:${k.path}`, { name: "known.forget", args: { env: result.a, with: result.b, path: k.path }, label: `no longer accepted: ${k.summary}` })}
                          disabled={pending.has(`forget:${k.path}`)}
                        >
                          forget
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
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
  const out = new Map<string, { driver: string; changes: { change: VaultChange; cause: string; fingerprint: string }[]; causes: Record<string, number> }>();
  (result.drift?.changes ?? []).forEach((change, i) => {
    const driver = change.driver ?? "driver set";
    const cause = result.causes?.[i] ?? "both changed";
    const fingerprint = result.fingerprints?.[i] ?? "";
    let g = out.get(driver);
    if (!g) {
      g = { driver, changes: [], causes: {} };
      out.set(driver, g);
    }
    g.changes.push({ change, cause, fingerprint });
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
  if (cause === "servers differ") {
    return "map the environment's servers (above)";
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

/** The environments whose servers aren't the tree's: each needs its tree servers mapped to its own. */
function serverSides(result: EnvCompareResult) {
  const sv = result.servers;
  if (!sv || sv.tree.length === 0) {
    return [];
  }
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((s) => y.some((t) => t.toLowerCase() === s.toLowerCase()));
  const out: { env: string; own: string[]; tree: string[]; names: string[]; map: Record<string, string> }[] = [];
  if (!same(sv.a, sv.tree)) {
    out.push({ env: result.a, own: sv.a, tree: sv.tree, names: sv.treeNames, map: sv.mapA });
  }
  if (!same(sv.b, sv.tree)) {
    out.push({ env: result.b, own: sv.b, tree: sv.tree, names: sv.treeNames, map: sv.mapB });
  }
  return out;
}
