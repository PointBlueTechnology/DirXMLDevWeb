import { DiffEditor } from "@monaco-editor/react";
import { monacoTheme } from "../monaco";
import { Fragment, useEffect, useRef, useState } from "react";
import { ApiError, GIT_CHANGED, api } from "../api";
import { EnvPicker, useEnvironment } from "../env";
import { CachePanel } from "./CachePanel";
import { EventsView } from "./EventsView";
import { TraceViewer } from "./TraceViewer";
import { CaptureSteps, ProductionCheck } from "./ProductionCheck";
import type { VaultTask, FileDiff, PullResult, DeployResult, Outline, Selection, VaultDiffResult, VaultStatus, VaultSnapshot, DriverAssociations, ObjectInspection, PasswordSync, VaultJobs, VaultPolicies, PolicyMembers, AppQueryResult, DriverHealth, LogLevel, DriverRights, DriverSetAdmin, EngineMetrics, WorkOrders, EmailServer, EngineInfo, DriverDetail, TraceShow, NamedPasswords, SimCase } from "../types";

type Tab = "compare" | "drivers" | "set" | "jobs" | "policies" | "objects" | "trace" | "events";

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
        {chosen && <span className={chosen.tier === "prd" ? "pill err" : "pill"}>{chosen.tier}</span>}
        {chosen?.hasOverrides && <span className="pill ok" title="overrides/<env>.properties is applied to the tree before it is compared or deployed">overrides</span>}
        <button className="link" onClick={() => onSelect({ type: "connections", env: chosen?.name })} title="Connection parameters, password and driver secrets">
          {chosen ? "Connection and secrets" : "Connections"}
        </button>
        <span className="spacer" />
        <div className="tabs">
          {(["compare", "drivers", "set", "jobs", "policies", "objects", "trace", "events"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)} data-testid={"vault-tab-" + t}>
              {t === "compare" ? "Compare & deploy" : t === "drivers" ? "Drivers" : t === "set" ? "Driver set" : t === "jobs" ? "Jobs" : t === "policies" ? "Policies" : t === "objects" ? "Objects" : t === "trace" ? "Trace" : "Events"}
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
      ) : tab === "set" ? (
        <DriverSetTab key={chosen.name} env={chosen.name} />
      ) : tab === "policies" ? (
        <Policies key={chosen.name} env={chosen.name} />
      ) : tab === "jobs" ? (
        <Jobs key={chosen.name} env={chosen.name} onFix={() => onSelect({ type: "connections", env: chosen.name })} />
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
  // a rotated password: the vault refused the bind (eDirectory -669/-222/-197, LDAP 49)
  const rejected = /error code 49|failed authentication|\(-669\)|\(-222\)|\(-197\)|invalid credentials/i.test(message);
  const certificate = /certificate (not trusted|changed)|vault's certificate/i.test(message);
  const connection = rejected || certificate || /connect |password|authentication|bind|environment '|secrets?/i.test(message);
  return (
    <div className="banner error">
      {rejected ? "The vault rejected your password. " : ""}
      {message}
      {connection && (
        <>
          {" "}
          <button className="link" onClick={onFix} data-testid="vault-fix">
            {rejected ? "Update password" : certificate ? "Check the certificate" : "Fix the connection or credentials"}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * A deploy or a rollback appends a line to deploy-log/<env>.jsonl (who, when, which commit, the snapshot, the outcome),
 * which is committed with the tree so the repository says what went where (#128). Commits that file alone, whatever
 * else is uncommitted; the commit bar then offers the push.
 */
function RecordCommit({ message }: { message: string }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const commit = () => {
    setBusy(true);
    api.git
      .commitRecord(message)
      .then((r) => setState({ ok: true, text: r.committed ? `Committed the deploy record as ${r.hash}. Push it from the bar at the top.` : "The deploy record is already committed." }))
      .catch((e: Error) => setState({ ok: false, text: e.message }))
      .finally(() => (setBusy(false), window.dispatchEvent(new Event(GIT_CHANGED))));
  };
  return state ? (
    <p className={state.ok ? "small ok-text" : "small err-text"} data-testid="vault-record-result">
      {state.text}
    </p>
  ) : (
    <p className="small" data-testid="vault-record">
      Recorded in <code>deploy-log/</code>: who, when, the commit and the snapshot.{" "}
      <button onClick={commit} disabled={busy} data-testid="vault-record-commit">
        {busy ? "Committing…" : "Commit the deploy record"}
      </button>{" "}
      <span className="muted">— that file alone, as “{message}”; the rest of your work stays uncommitted.</span>
    </p>
  );
}

/**
 * The vault's state into this branch (#67, `idm import-live --env`): read live, written into a copy of the tree, the
 * files that would change shown before and after; Apply writes the ones ticked (all, or a granular choice), then the
 * commit bar takes it from there.
 */
function PullDialog({ env, drivers, onClose, onApplied }: { env: string; drivers: string[]; onClose: () => void; onApplied: (r: PullResult) => void }) {
  const [result, setResult] = useState<PullResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState(0);
  // the files to take: every one, until some are unticked
  const [take, setTake] = useState<Set<string>>(new Set());
  // a line-level merge: per file, the text Apply writes when it isn't the vault's (blocks of the branch kept, edits)
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [resets, setResets] = useState(0);   // remounts the diff after "take all" / "keep all"
  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // the dry run plans against the tree as it is now; the apply must match the revision it reviewed
      const all = (result?.diffs ?? []).length;
      const merged = Object.fromEntries(Object.entries(edits).filter(([f, text]) => take.has(f) && text !== (result?.diffs ?? []).find((d) => d.file === f)?.after));
      const r = await api.vault.pull(env, drivers, dryRun, dryRun ? "" : result?.revision ?? "", !dryRun && take.size < all ? [...take] : undefined, !dryRun && Object.keys(merged).length ? merged : undefined);
      if (!dryRun) {
        onApplied(r);
        return;
      }
      setResult(r);
      setTake(new Set((r.diffs ?? []).map((d) => d.file)));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? "The tree changed on disk while this was open. Close, let the page reload, and review again." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const diffs: FileDiff[] = result?.diffs ?? [];
  const diff = diffs[selected];
  const isMerged = (d: FileDiff) => edits[d.file] !== undefined && edits[d.file] !== d.after;
  const mergeable = !!diff && diff.status !== "deleted" && diff.before !== undefined && diff.after !== undefined;
  const nothing = !!result && result.changedFiles.length === 0 && result.deletedFiles.length === 0;
  // a manifest lists the files beside it (a driver's policies and settings; the set's drivers and library): taking a
  // file without its changed manifest, or the manifest without its files, can leave a link to nothing
  const manifests = diffs.map((d) => d.file).filter((f) => f === "driverset.xml" || /^drivers\/[^/]+\/driver\.xml$/.test(f));
  const split = manifests.filter((m) => {
    const dir = m === "driverset.xml" ? "" : m.slice(0, -"driver.xml".length);
    // driverset.xml lists the drivers too: a driver added or removed whole goes with it
    const wholeDrivers = diffs.filter((d) => /^drivers\/[^/]+\/driver\.xml$/.test(d.file) && d.status !== "changed").map((d) => d.file.slice(0, -"driver.xml".length));
    const siblings = diffs
      .map((d) => d.file)
      .filter((f) => f !== m && f.startsWith(dir) && (dir !== "" || !f.startsWith("drivers/") || wholeDrivers.some((w) => f.startsWith(w))));
    return siblings.length > 0 && siblings.some((f) => take.has(f) !== take.has(m));
  });
  const toggle = (f: string, on: boolean) => {
    const next = new Set(take);
    if (on) {
      next.add(f);
    } else {
      next.delete(f);
    }
    setTake(next);
  };
  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal" data-testid="pull-dialog">
        <div className="modal-head">
          <h3>Update this branch from {env}{drivers.length ? `: ${drivers.join(", ")}` : ""}</h3>
          <span className="muted small">Nothing is written until you apply. Untick a file to leave it as this branch has it.</span>
        </div>
        <div className="modal-body">
          <div className="modal-side">
            <h4>Files</h4>
            {diffs.length === 0 ? (
              <p className="muted small">{busy ? "…" : "none"}</p>
            ) : (
              <>
                <div className="addrow tight small">
                  <button className="link" onClick={() => setTake(new Set(diffs.map((d) => d.file)))}>
                    all
                  </button>
                  <button className="link" onClick={() => setTake(new Set())}>
                    none
                  </button>
                </div>
                <ul className="filelist pickable">
                  {diffs.map((d, i) => (
                    <li key={d.file}>
                      <input type="checkbox" checked={take.has(d.file)} onChange={(e) => toggle(d.file, e.target.checked)} title={take.has(d.file) ? "Take this file from the vault" : "Leave this file as the branch has it"} data-testid={"pull-take-" + d.file} />
                      <button className={i === selected ? "leaf active" : "leaf"} onClick={() => setSelected(i)} title={d.file}>
                        <span className={"badge st-" + d.status}>{d.status === "changed" ? "M" : d.status === "added" ? "A" : "D"}</span>
                        {d.file.split("/").slice(-2).join("/")}
                        {isMerged(d) && <span className="pill small" title="Some of this branch's lines kept, or edited: Apply writes the merged text"> merged</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="modal-diff">
            {diff && mergeable && (
              <div className="addrow tight small mergebar" data-testid="pull-merge-bar">
                <span className="muted">
                  Left: this branch. Right: what Apply writes, {env}'s version to begin with. The arrow beside a block (point at it) keeps this branch's lines there; you
                  can also edit the right side.
                </span>
                <span className="spacer" />
                <button className="link" onClick={() => (setEdits(({ [diff.file]: _drop, ...rest }) => rest), setResets(resets + 1))} disabled={!isMerged(diff)}>
                  take all of {env}'s
                </button>
                <button className="link" onClick={() => (setEdits({ ...edits, [diff.file]: diff.before ?? "" }), setResets(resets + 1))}>
                  keep all of this branch
                </button>
              </div>
            )}
            {diff && diff.before !== undefined && diff.after !== undefined ? (
              <DiffEditor
                key={diff.file + ":" + resets}
                height={mergeable ? "calc(100% - 50px)" : "100%"}
                language={diff.language}
                original={diff.before}
                modified={edits[diff.file] ?? diff.after}
                theme={monacoTheme()}
                options={{ readOnly: !mergeable, originalEditable: false, renderMarginRevertIcon: mergeable, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: !mergeable, wordWrap: "on", diffWordWrap: "on", minimap: { enabled: false }, scrollBeyondLastLine: false }}
                onMount={(editor) => {
                  if (!mergeable) {
                    return;
                  }
                  const file = diff.file;
                  const modified = editor.getModifiedEditor();
                  modified.onDidChangeModelContent(() => {
                    const text = modified.getValue();
                    setEdits((cur) => ({ ...cur, [file]: text }));
                  });
                }}
              />
            ) : (
              <p className="muted pad">{busy ? "Reading the vault and writing it into a copy of the tree…" : diff ? "This file is not shown as text." : "No file would change: the branch already holds the vault's state."}</p>
            )}
          </div>
        </div>
        <div className="modal-result">
          {error && <p className="err-text">{error}</p>}
          {result && (
            <p className="small">
              {result.changedFiles.length} file(s) would be written, {result.deletedFiles.length} removed{take.size < diffs.length ? `; ${take.size} of ${diffs.length} ticked` : ""}.
              {result.unresolvedLinks > 0 ? ` ${result.unresolvedLinks} link(s) resolve to nothing in the result.` : ""}
            </p>
          )}
          {Object.keys(edits).filter((f) => take.has(f) && isMerged(diffs.find((d) => d.file === f) ?? ({ file: f } as FileDiff))).length > 0 && (
            <p className="small" data-testid="pull-merged-count">
              {Object.keys(edits).filter((f) => take.has(f) && isMerged(diffs.find((d) => d.file === f) ?? ({ file: f } as FileDiff))).length} file(s) merged line by line: Apply writes
              them as merged.
            </p>
          )}
          {split.length > 0 && (
            <p className="warn-text small" data-testid="pull-split">
              {split.map((m) => (m === "driverset.xml" ? "driverset.xml lists the drivers and the Library" : `${m} lists that driver's policies and settings`)).join("; ")}: take it together with the files
              beside it, or links may point at nothing. Validation shows any after you apply.
            </p>
          )}
          {result && result.notes.length > 0 && (
            <ul className="plain small">
              {result.notes.map((n, i) => (
                <li key={i}>
                  {n}
                  {/^server .*: not read/.test(n) && (
                    <>
                      {" "}
                      <a className="link" href={`#type=connections&env=${encodeURIComponent(env)}`} data-testid="pull-servers-link">
                        Give its address under Connections → {env} → Servers
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="modal-foot">
          <span className="muted small">Applying writes the files into this branch's tree; commit them from the bar at the top.</span>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !result || nothing || take.size === 0} onClick={() => void run(false)} data-testid="pull-apply">
            {take.size < diffs.length ? `Apply ${take.size} of ${diffs.length} files` : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** m:ss */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The server's "now" for a task, ticking: its answer's clock plus the time since it came (the browser's clock may differ). */
function useServerNow(task: VaultTask): number {
  const [since, setSince] = useState(() => ({ server: task.now, local: Date.now() }));
  const [, tick] = useState(0);
  useEffect(() => setSince({ server: task.now, local: Date.now() }), [task.now]);
  useEffect(() => {
    if (!task.running) {
      return;
    }
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [task.running]);
  return since.server + (Date.now() - since.local);
}

const VERB: Record<VaultTask["kind"], string> = { deploy: "Deploying to", rollback: "Rolling back" };

/** One line at the top of the tab while a deploy or rollback runs, someone else's included. */
function TaskLine({ task, mine }: { task: VaultTask; mine: boolean }) {
  const now = useServerNow(task);
  const last = task.lines[task.lines.length - 1];
  return (
    <div className="banner warn" style={{ display: "flex", gap: 8, alignItems: "center" }} data-testid="vault-task-line">
      <span className="spinner" />
      <span>
        {VERB[task.kind]} {task.env}
        {mine ? "" : ` (started by ${task.user}${task.branch ? ` on ${task.branch}` : ""})`} — {clock(now - task.startedAt)}
        {last ? ` — ${last.text}` : ""}. Other writes to {task.env} wait until it finishes; leaving this page does not stop it.
      </span>
    </div>
  );
}

/** A deploy or rollback step by step, as the server reports it: each step's time from the start, the current one's clock. */
function TaskProgress({ task }: { task: VaultTask }) {
  const now = useServerNow(task);
  const end = task.finishedAt ?? now;
  const body = (
    <ol className="plain small task-lines" data-testid="vault-task-lines">
      {task.lines.map((l, i) => {
        const current = task.running && i === task.lines.length - 1;
        return (
          <li key={i} className={current ? "current" : ""}>
            <code className="muted">+{clock(l.at - task.startedAt)}</code> {l.text}
            {current && <span className="muted"> … {clock(now - l.at)}</span>}
          </li>
        );
      })}
      {task.running && task.lines.length === 0 && <li className="muted">starting…</li>}
    </ol>
  );
  if (task.running) {
    return (
      <div className="block" data-testid="vault-task">
        <h4 className="addrow tight" style={{ margin: 0 }}>
          <span className="spinner" /> {VERB[task.kind]} {task.env} — {clock(now - task.startedAt)}
        </h4>
        {body}
      </div>
    );
  }
  return (
    <details className="block" data-testid="vault-task">
      <summary className="small">
        {task.kind === "deploy" ? "Deploy" : "Rollback"} to {task.env} by {task.user}: {task.lines.length} step(s) in {clock(end - task.startedAt)}, finished{" "}
        {clock(now - end)} ago
      </summary>
      {body}
    </details>
  );
}

function Compare({ env, drivers, revision, onOpen, onFix }: { env: string; drivers: string[]; revision: string; onOpen: (path: string) => void; onFix: () => void }) {
  const [only, setOnly] = useState<string>("");
  const [restart, setRestart] = useState(true);
  const [secrets, setSecrets] = useState<"none" | "missing" | "all">("none");
  const [allowMissing, setAllowMissing] = useState(false);
  const [pulling, setPulling] = useState(false);
  // #136: a capture of the environment's state, and the steps on from it
  const [captured, setCaptured] = useState<DeployResult | null>(null);
  const [deleteDrivers, setDeleteDrivers] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<VaultSnapshot[] | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [rollbackOf, setRollbackOf] = useState<VaultSnapshot | null>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState("");
  const [rollbackResult, setRollbackResult] = useState<DeployResult | null>(null);
  const choices = { restart, secrets, allowMissingSecrets: allowMissing, deleteDrivers, captureDrift: false };
  const loadSnapshots = () =>
    api.vault
      .snapshots(env)
      .then((r) => setSnapshots(r.snapshots))
      .catch((e: Error) => setError(e.message));
  const rollback = () =>
    act("Starting the rollback…", async () => {
      if (!rollbackOf) {
        return;
      }
      setRollbackResult(null);
      const r = await api.vault.rollbackStart(env, rollbackOf.file, rollbackConfirm, rollbackOf.server);
      await follow(r, setRollbackResult);
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
  const scopeLabel = only ? `${only} only` : "the whole driver set";
  const stale = diff !== null && comparedAt !== revision;
  // the plan answers for the options it was made with: changing one leaves it on screen, marked out of date
  const choicesKey = JSON.stringify({ scope, ...choices });
  const [plannedWith, setPlannedWith] = useState("");
  const planOutdated = plan !== null && plannedWith !== choicesKey;

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
      setCaptured(null);
      setDiff(await api.vault.diff(env, scope));
      setComparedAt(revision);
    });
  const makePlan = () =>
    act("Planning…", async () => {
      setResult(null);
      setPlannedWith(choicesKey);
      setPlan(await api.vault.plan(env, scope, choices));
    });
  const captureState = () =>
    act(`Reading ${env} and recording its state…`, async () => {
      setResult(null);
      setCaptured(await api.vault.capture(env));
    });
  const deploy = () =>
    act("Starting the deploy…", async () => {
      setResult(null);
      const r = await api.vault.deployStart(env, scope, choices, confirm);
      await follow(r, setResult);
    });

  // ---- a deploy or rollback runs on the server as a task: followed here, step by step ----
  const [task, setTask] = useState<VaultTask | null>(null);
  const followed = useRef<string | null>(null);   // the task this view started or watched running
  const finished = useRef<string | null>(null);   // the task whose result this view has taken in
  const running = task?.running ?? false;
  /** A start's answer: the task to follow, or a refusal (another write to the environment is running). */
  const follow = async (r: DeployResult & { task?: string }, refused: (r: DeployResult) => void) => {
    if (!r.task) {
      refused(r);
      return;
    }
    followed.current = r.task;
    const t = await api.vault.task({ id: r.task });
    if ("id" in t) {
      setTask(t as VaultTask);
    }
  };
  // the latest deploy or rollback to this environment: one running (anyone's), or one finished in the last half hour
  useEffect(() => {
    let live = true;
    api.vault
      .task({ env })
      .then((t) => {
        if (live && "id" in t) {
          const vt = t as VaultTask;
          if (vt.running || (vt.finishedAt !== null && vt.now - vt.finishedAt < 30 * 60 * 1000)) {
            if (vt.running) {
              followed.current = vt.id;
            }
            setTask(vt);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [env]);
  // poll while it runs
  useEffect(() => {
    if (!task || !task.running) {
      return;
    }
    const timer = window.setTimeout(() => {
      api.vault
        .task({ id: task.id })
        .then((t) => "id" in t && setTask(t as VaultTask))
        .catch(() => setTask({ ...task }));   // a missed answer: ask again
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [task]);
  // take its result in once: the result block, and (for one followed here) the comparison again
  useEffect(() => {
    if (!task || task.running || !task.result || finished.current === task.id) {
      return;
    }
    finished.current = task.id;
    const r = task.result;
    const here = followed.current === task.id;
    window.dispatchEvent(new Event(GIT_CHANGED));   // the deploy record
    if (task.kind === "deploy") {
      setResult(r);
      setConfirm("");
      if (r.ok && here) {
        setPlan(null);
        void act("Comparing…", async () => {
          setDiff(await api.vault.diff(env, scope));
          setComparedAt(revision);
        });
      }
    } else {
      setRollbackResult(r);
      setRollbackConfirm("");
      if (r.ok && here) {
        setRollbackOf(null);
        setDiff(null);
        setPlan(null);
        setResult(null);
        void loadSnapshots();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  const gate = plan && !planOutdated ? plan.gate : null;
  const deployBlocked = !plan || !plan.ok || !!plan.refusal || planOutdated || stale || !!gate;
  const compareState = !diff ? "not yet" : stale ? "out of date" : diff.empty ? "matches" : `${diff.changes.length} difference${diff.changes.length === 1 ? "" : "s"}`;
  const planState = !plan ? "not yet" : planOutdated ? "options changed" : plan.refusal ? "refused" : gate ? "blocked" : "ready";
  const deployState = running ? "running" : result ? (result.ok ? "deployed" : result.refusal ? "refused" : "failed") : "not yet";
  const pill = (state: string) => (["matches", "ready", "deployed"].includes(state) ? "pill ok" : ["out of date", "options changed", "blocked", "refused", "failed"].includes(state) ? "pill warn" : "pill");
  return (
    <div className="pad deploysteps">
      {pulling && (
        <PullDialog
          env={env}
          drivers={scope}
          onClose={() => setPulling(false)}
          onApplied={(r) => {
            setPulling(false);
            setDiff(null);
            setPlan(null);
            setResult(null);
            window.dispatchEvent(new CustomEvent("idmweb:suggest-commit", { detail: `Capture drift from ${env}${r.drivers.length ? ` (${r.drivers.join(", ")})` : ""}` }));
          }}
        />
      )}
      <div className="addrow">
        <label className="field">
          <em>Scope</em>
          <select value={only} onChange={(e) => (setOnly(e.target.value), setDiff(null), setPlan(null), setResult(null))} data-testid="vault-scope">
            <option value="">the whole driver set</option>
            {drivers.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <span className="muted small">
          Compare, plan and deploy cover <strong>{scopeLabel}</strong>
          {only ? "; nothing outside it is written" : ", every driver and the driver set's own objects (jobs, RBE policies, templates)"}.
        </span>
        {busy && <span className="muted">{busy}</span>}
      </div>
      {error && <VaultError message={error} onFix={onFix} />}
      {task && task.running && <TaskLine task={task} mine={followed.current === task.id} />}

      <section className="step" data-testid="step-compare">
        <header>
          <span className="stepnum">1</span>
          <h4>
            Compare {scopeLabel} with {env}
          </h4>
          <span className={pill(compareState)}>{compareState}</span>
        </header>
        <p className="muted small">Reads the vault and lists every difference from this branch's tree. Nothing is written.</p>
        <div className="addrow">
          <button className={diff ? "" : "primary"} onClick={compare} disabled={busy !== null} data-testid="vault-compare">
            {diff ? "Compare again" : "Compare"}
          </button>
          <span className="spacer" />
          <button onClick={() => setPulling(true)} disabled={busy !== null} title="import-live: reviewed first; with overrides/, the environment's values go to its overrides file" data-testid="vault-pull">
            Update this branch from {env}…
          </button>
          <span className="muted small">the other way: write what {env} holds into this branch's files, for you to review and commit</span>
        </div>
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
              </>
            )}
          </>
        )}
      </section>

      <section className={diff && !diff.empty ? "step" : "step later"} data-testid="step-plan">
        <header>
          <span className="stepnum">2</span>
          <h4>Plan the deploy of {scopeLabel}</h4>
          <span className={pill(planState)}>{planState}</span>
        </header>
        {!diff || diff.empty ? (
          <p className="muted small">{!diff ? "Compare first." : "Nothing to plan: the vault matches the tree."}</p>
        ) : (
          <>
            <p className="muted small">Lists each write the deploy would make, and checks what a deploy to {env} needs. Nothing is written.</p>
            {diff.changes.some((c) => c.kind.toUpperCase() === "DRIVER_REMOVED" && c.driver) && (
              <div className="block" data-testid="vault-delete-drivers">
                <h4>Drivers only in the vault</h4>
                <p className="muted small">A deploy leaves them alone unless asked. Tick one to delete its whole subtree from {env}; it must be stopped, the plan refuses otherwise; the snapshot captures it first, so a rollback brings it back.</p>
                {diff.changes
                  .filter((c) => c.kind.toUpperCase() === "DRIVER_REMOVED" && c.driver)
                  .map((c) => (
                    <label key={c.driver} className="checkchip">
                      <input type="checkbox" checked={deleteDrivers.includes(c.driver!)} onChange={(e) => setDeleteDrivers(e.target.checked ? [...deleteDrivers, c.driver!] : deleteDrivers.filter((d) => d !== c.driver))} data-testid={"vault-delete-" + c.driver} /> delete {c.driver} from the vault
                    </label>
                  ))}
              </div>
            )}
            <div className="addrow">
              <label className="checkchip">
                <input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} /> restart the drivers a change needs restarted
              </label>
              <label className="field">
                <em>Secrets</em>
                <select value={secrets} onChange={(e) => setSecrets(e.target.value as "none" | "missing" | "all")} title="A driver's shim, Remote Loader and named passwords, from the environment's secrets file: left alone on an update unless asked" data-testid="vault-secrets">
                  <option value="none">leave alone (set on a first deploy only)</option>
                  <option value="missing">set named passwords the vault lacks</option>
                  <option value="all">re-set every provided secret (a rotated password)</option>
                </select>
              </label>
              <label className="checkchip" title="A first deploy of a driver refuses when a secret it needs is not provided; allow it to create the driver stopped and list what to set">
                <input type="checkbox" checked={allowMissing} onChange={(e) => setAllowMissing(e.target.checked)} data-testid="vault-allow-missing" /> allow missing secrets on a first deploy
              </label>
              <button className={plan && !planOutdated ? "" : "primary"} onClick={makePlan} disabled={busy !== null || stale || running} data-testid="vault-plan">
                {plan ? "Plan again" : "Plan the deploy"}
              </button>
            </div>
            {planOutdated && <div className="banner warn">The options changed since this plan. Plan again to deploy with them.</div>}
            {plan && (
              <div className={planOutdated ? "block faded" : "block"}>
                {plan.refusal && <div className="banner error">{plan.refusal}</div>}
                {gate && <ProductionCheck env={env} kind={plan.gateKind} message={gate} busy={busy !== null} onCapture={captureState} onDone={makePlan} />}
                {captured && <CaptureSteps env={env} result={captured} onCompare={compare} />}
                <details open={!gate} className="small">
                  <summary>The plan: each write, nothing done yet</summary>
                  <pre className="outcome" data-testid="vault-plan-text">
                    {plan.plan ?? plan.text}
                  </pre>
                </details>
              </div>
            )}
          </>
        )}
      </section>

      <section className={plan ? "step" : "step later"} data-testid="step-deploy">
        <header>
          <span className="stepnum">3</span>
          <h4>
            Deploy {scopeLabel} to {env}
          </h4>
          <span className={pill(deployState)}>{deployState}</span>
        </header>
        {!result && !running && (
          <>
            <p className="muted small">A snapshot of what changes is taken first, then the writes, the restarts, and a comparison to verify. You can leave the page while it runs.</p>
            <div className="addrow">
              <Confirm env={env} value={confirm} onChange={setConfirm} />
              <button className="danger" onClick={deploy} disabled={busy !== null || deployBlocked || confirm !== env || running} data-testid="vault-deploy">
                Deploy to {env}
              </button>
              {deployBlocked && (
                <span className="muted small">
                  {!plan ? "Plan first." : planOutdated ? "Plan again: the options changed." : stale ? "Compare again: the tree changed." : gate ? "See what the plan found above." : plan.refusal ? "The plan was refused." : ""}
                </span>
              )}
            </div>
          </>
        )}
        {task && task.kind === "deploy" && <TaskProgress task={task} />}
        {result && (
          <div className="block">
            <h4 className={result.ok ? "ok-text" : "err-text"}>{result.ok ? `Deployed to ${env}` : result.refusal ? "Not deployed: refused" : "Failed"}</h4>
            {result.refusal && result.gateKind && result.gateKind !== "confirm" ? (
              <ProductionCheck env={env} kind={result.gateKind} message={result.refusal} busy={busy !== null} onCapture={captureState} onDone={() => (setResult(null), void makePlan())} />
            ) : (
              <pre className="outcome" data-testid="vault-result">
                {result.refusal ?? result.text}
              </pre>
            )}
            {captured && !plan && <CaptureSteps env={env} result={captured} onCompare={compare} />}
            {!result.refusal && result.snapshot && <RecordCommit key={result.snapshot ?? result.text} message={`Deployed to ${env}${scope.length ? ` (${scope.join(", ")})` : ""}`} />}
            {result.snapshot && (
              <p className="muted small">
                Snapshot: <code>{result.snapshot}</code>{" "}
                <button className="link" onClick={() => (setRollbackOf({ file: result.snapshot!, name: result.snapshot!.replace(/^.*\//, ""), server: null, bytes: 0, ok: true }), setRollbackResult(null))} data-testid="vault-rollback-last">
                  Roll back to it…
                </button>
              </p>
            )}
            {!running && (
              <button className="link" onClick={() => (setResult(null), setConfirm(""))}>
                {result.ok ? "Done" : "Back to the deploy"}
              </button>
            )}
          </div>
        )}
      </section>

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
              <button className="danger" onClick={rollback} disabled={busy !== null || rollbackConfirm !== env || running} data-testid="vault-rollback-go">
                Roll back
              </button>
              <button onClick={() => setRollbackOf(null)} disabled={busy !== null}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {task && task.kind === "rollback" && <TaskProgress task={task} />}
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
            {!rollbackResult.refusal && rollbackResult.snapshot && <RecordCommit key={rollbackResult.snapshot ?? rollbackResult.text} message={`Rolled ${env} back`} />}
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
  const [opsOf, setOpsOf] = useState<string | null>(null);
  const [manageOf, setManageOf] = useState<string | null>(null);
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
      <EngineStrip env={env} />
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
                  </button>{" "}
                  <button className="mini" onClick={() => setOpsOf(opsOf === d.name ? null : d.name)} title="Health, log level and effective rights of the driver" data-testid={"ops-view-" + d.name}>
                    {opsOf === d.name ? "hide" : "health"}
                  </button>{" "}
                  <button className="mini" onClick={() => setManageOf(manageOf === d.name ? null : d.name)} title="Status, trace file and reset, resync, migrate, submit, named passwords" data-testid={"manage-view-" + d.name}>
                    {manageOf === d.name ? "hide" : "manage"}
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
      {opsOf && <DriverOpsPanel key={opsOf} env={env} driver={opsOf} armed={armed} confirm={confirm} onClose={() => setOpsOf(null)} />}
      {manageOf && <DriverManagePanel key={manageOf} env={env} driver={manageOf} armed={armed} confirm={confirm} onSelect={onSelect} onClose={() => setManageOf(null)} />}
      {cacheOf && <CachePanel key={cacheOf} env={env} driver={cacheOf} armed={armed} confirm={confirm} deployer onClose={() => setCacheOf(null)} onSaved={onSaved} onSimulator={() => onSelect({ type: "simulator" })} />}
    </div>
  );
}

/** The engine's version and statistics: JVM heap and threads, and each driver's counters (`engine.version`, `engine.stats`). */
function EngineStrip({ env }: { env: string }) {
  const [data, setData] = useState<EngineInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setBusy(true);
    api.vault
      .engine(env)
      .then((d) => (setData(d), setError(null)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [env]);
  const jvm = data?.stats.jvm;
  return (
    <div className="addrow tight small" data-testid="engine-strip">
      <b>Engine</b>
      {error ? <span className="muted">{error}</span> : !data ? <span className="muted">reading…</span> : (
        <>
          <span>{data.version.ok ? data.version.version ?? data.version.text.trim() : data.version.error ?? "version unknown"}</span>
          {jvm && (
            <span className="muted">
              · heap {jvm.heapUsed} used of {jvm.heapCommitted} (max {jvm.heapTotal}) · threads {jvm.threadsCurrent} ({jvm.threadsDaemon} daemon, peak {jvm.threadsPeak})
            </span>
          )}
        </>
      )}
      <button className="mini" onClick={load} disabled={busy}>
        {busy ? "…" : "refresh"}
      </button>
      {data?.stats.drivers && data.stats.drivers.length > 0 && (
        <button className="mini" onClick={() => setOpen(!open)}>
          {open ? "hide counters" : "driver counters"}
        </button>
      )}
      {open && data?.stats.drivers && (
        <table className="grid" style={{ width: "100%" }} data-testid="engine-counters">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Cache</th>
              <th>Unprocessed</th>
              <th>Reported events</th>
              <th>Commands</th>
            </tr>
          </thead>
          <tbody>
            {data.stats.drivers.map((d) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td>{d.cacheSize}</td>
                <td>{d.unprocessedSize}</td>
                <td>{d.reportedEvents}</td>
                <td>{d.commands}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * One driver managed from the page (#68, #69): its status as `driver.status` reports it with recent audit lines, the
 * trace file and reset, the trace file read over SSH into the Trace Viewer, resync, migrate from the application,
 * submit an XDS command (with the simulator canary), and the driver's named passwords in the vault.
 */
function DriverManagePanel({ env, driver, armed, confirm, onSelect, onClose }: { env: string; driver: string; armed: boolean; confirm: string; onSelect: (s: Selection) => void; onClose: () => void }) {
  const [status, setStatus] = useState<DriverDetail | null>(null);
  const [trace, setTrace] = useState<TraceShow | null>(null);
  const [names, setNames] = useState<NamedPasswords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<{ ok: boolean; text: string; open?: string } | null>(null);
  const [file, setFile] = useState("");
  const [tailLines, setTailLines] = useState("500");
  const [tailGrep, setTailGrep] = useState("");
  const [tailSince, setTailSince] = useState("");
  const [since, setSince] = useState("");
  const [xds, setXds] = useState("");
  const [canary, setCanary] = useState(true);
  const [cases, setCases] = useState<SimCase[] | null>(null);
  const [pwName, setPwName] = useState("");
  const [pwValue, setPwValue] = useState("");
  const load = () => {
    setBusy("Reading…");
    Promise.all([api.vault.driverStatus(env, driver), api.vault.traceShow(env, driver), api.vault.namedPasswords(env, driver)])
      .then(([s, t, n]) => (setStatus(s), setTrace(t), setNames(n), setFile(String(t.file ?? "")), setError(null)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [env, driver]);
  const run = (label: string, p: Promise<{ ok: boolean; text: string; canary?: string | null; stored?: string }>, after?: () => void) => {
    setBusy(label);
    setLast(null);
    p.then((r) => (setLast({ ok: r.ok, text: r.text + (r.canary ? `\ncanary: ${r.canary}` : ""), open: r.stored }), after ? after() : load()))
      .catch((e: Error) => setLast({ ok: false, text: e.message }))
      .finally(() => setBusy(null));
  };
  const pickCase = (name: string) => {
    if (!name) return;
    api.sim
      .files(name)
      .then((f) => setXds(f.input ?? ""))
      .catch((e: Error) => setLast({ ok: false, text: e.message }));
  };
  const showCases = () => {
    if (cases) return;
    api.sim
      .cases()
      .then((c) => setCases(c.cases))
      .catch(() => setCases([]));
  };
  return (
    <section className="block" data-testid="manage-panel">
      <div className="addrow tight">
        <h4 style={{ margin: 0 }}>{driver}: status, trace, operations, named passwords</h4>
        {busy && <span className="muted small">{busy}</span>}
        <span className="spacer" />
        <button className="mini" onClick={load} disabled={busy !== null}>
          refresh
        </button>
        <button className="mini" onClick={onClose}>
          close
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {last && (
        <div>
          <pre className={last.ok ? "outcome" : "outcome err-text"}>{last.text}</pre>
          {last.open && (
            <button className="mini" onClick={() => onSelect({ type: "trace", file: last.open as string })} data-testid="tail-open">
              Open in the Trace Viewer
            </button>
          )}
        </div>
      )}

      <h4>Status</h4>
      {status && !status.ok && <p className="muted small">{status.error ?? status.text}</p>}
      {status && status.ok && (
        <>
          <table className="grid" data-testid="driver-status">
            <tbody>
              <tr><td>DN</td><td className="small"><code>{status.dn}</code></td></tr>
              <tr><td>State</td><td>{status.state} · start option {status.startOption}</td></tr>
              <tr><td>Cache</td><td>{status.cacheSize} · unprocessed {status.unprocessedSize}</td></tr>
              <tr><td>Trace</td><td>level {status.traceLevel ?? "-"} · file {status.traceFile || "-"}</td></tr>
              <tr><td>Named passwords</td><td className="small">{(status.namedPasswords ?? []).length === 0 ? <span className="muted">none</span> : (status.namedPasswords ?? []).join(", ")}</td></tr>
            </tbody>
          </table>
          {(status.audit ?? []).length > 0 && (
            <details>
              <summary className="small">Recent audit lines ({(status.audit ?? []).length})</summary>
              <ul className="plain small">
                {(status.audit ?? []).map((a, i) => (
                  <li key={i}>
                    <span className="muted">{a.timestamp}</span> <span className={a.outcome === "ok" ? "pill ok" : "pill err"}>{a.outcome}</span> {a.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <h4>Trace</h4>
      {trace && trace.ok && (
        <p className="small">
          Level {trace.level ?? "-"} · file <code>{trace.file || "-"}</code>
        </p>
      )}
      <div className="addrow tight">
        <input className="wide" value={file} onChange={(e) => setFile(e.target.value)} placeholder="/var/opt/novell/eDirectory/log/driver.trace (empty: no file)" spellCheck={false} disabled={!armed || busy !== null} data-testid="trace-file" />
        <button className="mini" disabled={!armed || busy !== null || file === String(trace?.file ?? "")} onClick={() => run("Setting the trace file…", api.vault.traceFile(env, driver, file, confirm))} data-testid="trace-file-set">
          Set file
        </button>
        <button className="mini" disabled={!armed || busy !== null} onClick={() => run("Resetting the trace…", api.vault.traceReset(env, driver, confirm))} title="Back to the level and file from before the last recorded trace change" data-testid="trace-reset">
          Reset to previous
        </button>
      </div>
      {trace?.sshTail ? (
        <div className="addrow tight">
          <span className="small">Read the trace file over SSH:</span>
          <input value={tailLines} onChange={(e) => setTailLines(e.target.value.replace(/[^0-9]/g, ""))} placeholder="lines" style={{ width: 70 }} disabled={!armed || busy !== null} />
          <input value={tailSince} onChange={(e) => setTailSince(e.target.value.replace(/[^0-9]/g, ""))} placeholder="or the last N minutes" style={{ width: 150 }} disabled={!armed || busy !== null} />
          <input value={tailGrep} onChange={(e) => setTailGrep(e.target.value)} placeholder="grep" spellCheck={false} style={{ width: 160 }} disabled={!armed || busy !== null} />
          <button className="mini" disabled={!armed || busy !== null} onClick={() => run("Reading the trace file…", api.vault.traceTail(env, driver, { lines: Number(tailLines || 500), grep: tailGrep || undefined, since: tailSince ? Number(tailSince) : undefined, confirm }), () => undefined)} data-testid="trace-tail">
            Read
          </button>
        </div>
      ) : (
        <p className="muted small">The environment names no SSH host, so its trace file can't be read from here; the Trace tab's live stream works without one.</p>
      )}

      <h4>Resync</h4>
      <div className="addrow tight">
        <input value={since} onChange={(e) => setSince(e.target.value)} placeholder="since (ISO-8601; empty: a full resync)" spellCheck={false} style={{ width: 280 }} disabled={!armed || busy !== null} />
        <button className="mini" disabled={!armed || busy !== null} onClick={() => run("Resyncing…", api.vault.resync(env, driver, since.trim() || undefined, confirm))} data-testid="resync">
          Resync
        </button>
        <span className="muted small">The driver must be running.</span>
      </div>

      <h4>Migrate from the application, or submit a command</h4>
      <div className="addrow tight">
        <select onFocus={showCases} onChange={(e) => pickCase(e.target.value)} defaultValue="" title="Fill the editor with a simulator case's input">
          <option value="">from a simulator case…</option>
          {(cases ?? []).filter((c) => !c.driver || c.driver === driver).map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="checkchip small" title="Run the same command through the simulator on the workspace's tree first, and compare what the shim received with it">
          <input type="checkbox" checked={canary} onChange={(e) => setCanary(e.target.checked)} /> canary on submit
        </label>
      </div>
      <textarea className="mono" rows={8} style={{ width: "100%" }} value={xds} onChange={(e) => setXds(e.target.value)} placeholder="<nds dtdversion=&quot;4.0&quot;><input><query class-name=&quot;User&quot; scope=&quot;subtree&quot;>…</query></input></nds>" spellCheck={false} data-testid="xds" />
      <div className="addrow tight">
        <button className="mini" disabled={!armed || busy !== null || !xds.trim()} onClick={() => run("Migrating…", api.vault.migrate(env, driver, xds, confirm))} title="MigrateApp: the engine queries the application with this document and synchronizes what it finds" data-testid="migrate">
          Migrate from the application
        </button>
        <button className="mini" disabled={!armed || busy !== null || !xds.trim()} onClick={() => run("Submitting…", api.vault.submit(env, driver, xds, canary, confirm))} title="SubmitCommand: the document goes down the running driver's subscriber channel" data-testid="submit">
          Submit command
        </button>
      </div>

      <h4>Named passwords in the vault</h4>
      {names && names.ok && (
        <p className="small">
          {(names.names ?? []).length === 0 ? <span className="muted">None set on the driver.</span> : (names.names ?? []).map((n) => (
            <span key={n} style={{ marginRight: 12 }}>
              <code>{n}</code>{" "}
              <button className="mini" disabled={!armed || busy !== null} onClick={() => run("Removing…", api.vault.namedPassword(env, driver, "remove", n, undefined, confirm))} data-testid={"pw-remove-" + n}>
                remove
              </button>
            </span>
          ))}
        </p>
      )}
      <div className="addrow tight">
        <input value={pwName} onChange={(e) => setPwName(e.target.value)} placeholder="name" spellCheck={false} style={{ width: 180 }} disabled={!armed || busy !== null} />
        <input type="password" value={pwValue} onChange={(e) => setPwValue(e.target.value)} placeholder="value (never shown again)" autoComplete="new-password" style={{ width: 220 }} disabled={!armed || busy !== null} />
        <button className="mini" disabled={!armed || busy !== null || !pwName.trim() || !pwValue} onClick={() => (run("Setting the named password…", api.vault.namedPassword(env, driver, "set", pwName.trim(), pwValue, confirm)), setPwValue(""))} data-testid="pw-set">
          Set
        </button>
        <span className="muted small">Written to the driver in the vault; the local secrets file a deploy reads is under Connections.</span>
      </div>
    </section>
  );
}

const LOG_LEVELS: [string, string][] = [
  ["errors", "Log errors"],
  ["errors-and-warnings", "Log errors and warnings"],
  ["last-log-time", "Only update the last log time"],
  ["off", "Logging off"],
];

/** A driver's health (the Driver Health job's verdict), its log level and its effective rights (`driver.health`, `driver.log-level`, `driver.rights`). */
function DriverOpsPanel({ env, driver, armed, confirm, onClose }: { env: string; driver: string; armed: boolean; confirm: string; onClose: () => void }) {
  const [health, setHealth] = useState<DriverHealth | null>(null);
  const [log, setLog] = useState<LogLevel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const [level, setLevel] = useState("");
  const [limit, setLimit] = useState("");
  const [dn, setDn] = useState("");
  const [attrs, setAttrs] = useState("");
  const [rights, setRights] = useState<DriverRights | null>(null);
  const load = () => {
    setBusy("Reading…");
    Promise.all([api.vault.health(env, driver), api.vault.logLevel(env, driver)])
      .then(([h, l]) => (setHealth(h), setLog(l), setError(null)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [env, driver]);
  const clearHealth = () => {
    setBusy("Clearing…");
    api.vault
      .healthClear(env, driver, confirm)
      .then((r) => (setLast({ ok: r.ok, text: r.text }), load()))
      .catch((e: Error) => setLast({ ok: false, text: e.message }))
      .finally(() => setBusy(null));
  };
  const setLog2 = (req: { level?: string; limit?: number; inherit?: boolean }) => {
    setBusy("Setting the log level…");
    api.vault
      .logLevelSet(env, { driver, ...req, confirm })
      .then((r) => (setLast({ ok: r.ok, text: r.text }), load()))
      .catch((e: Error) => setLast({ ok: false, text: e.message }))
      .finally(() => setBusy(null));
  };
  const checkRights = () => {
    setBusy("Reading rights…");
    api.vault
      .rights(env, driver, dn, attrs.split(/[,\s]+/).map((a) => a.trim()).filter(Boolean))
      .then(setRights)
      .catch((e: Error) => setRights({ ok: false, error: e.message, text: "" }))
      .finally(() => setBusy(null));
  };
  const stateClass = (s: string) => (s === "green" || s === "true" ? "pill ok" : s === "yellow" ? "pill warn" : s === "red" ? "pill err" : "pill");
  return (
    <section className="block" data-testid="ops-panel">
      <div className="addrow tight">
        <h4 style={{ margin: 0 }}>{driver}: health, log level, rights</h4>
        {busy && <span className="muted small">{busy}</span>}
        <span className="spacer" />
        <button className="mini" onClick={onClose}>
          close
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {last && <div className={last.ok ? "banner ok" : "banner error"}>{last.text}</div>}

      <h4>Health</h4>
      {health && !health.ok && <p className="muted small">{health.error ?? health.text}</p>}
      {health && health.ok && (
        <>
          {(health.states ?? []).length === 0 ? (
            <p className="muted small">No health status recorded: the Driver Health job has not evaluated this driver.</p>
          ) : (
            <p className="small">
              {(health.states ?? []).map((s, i) => (
                <span key={i} style={{ marginRight: 12 }}>
                  {s.customState ? <>custom state <code>{s.customState}</code> </> : null}
                  <span className={stateClass(s.state)}>{s.state}</span> <span className="muted">on {s.server}</span>
                </span>
              ))}
            </p>
          )}
          <p className="small muted">
            {(health.configured ?? []).length === 0
              ? "No health configuration on the driver (its manifest has no <health-config>)."
              : "Configured: " + (health.configured ?? []).map((c) => `${c.state} (${c.conditionGroups} condition group(s), ${c.actions} action(s))`).join(", ") + "."}{" "}
            {(health.jobs ?? []).length === 0
              ? "No Driver Health job in the driver set, so nothing evaluates it."
              : "Health jobs: " + (health.jobs ?? []).map((j) => `${j.name}${j.disabled ? " (disabled)" : ""}${j.inScope ? "" : " — not scoped to this driver"}`).join(", ") + "."}
          </p>
          <button className="mini" disabled={!armed || busy !== null || (health.states ?? []).length === 0} onClick={clearHealth} title="Remove the recorded health status (the console's Clear Health Status)" data-testid="health-clear">
            Clear status
          </button>
        </>
      )}

      <h4>Log level</h4>
      {log && !log.ok && <p className="muted small">{log.error ?? log.text}</p>}
      {log && log.ok && (
        <>
          <p className="small">
            {log.inherits ? (
              <span className="muted">Uses the driver set's settings.</span>
            ) : (
              <>
                {log.levelName ? <b>{log.levelName}</b> : <span className="muted">No log level of its own</span>}
                {log.events && log.events.length > 0 ? <span className="muted"> · events {log.events.join(" ")}</span> : null}
                {log.limit != null ? <span className="muted"> · keeps {log.limit} entries</span> : null}
              </>
            )}
          </p>
          <div className="addrow tight">
            <select value={level} onChange={(e) => setLevel(e.target.value)} disabled={!armed || busy !== null} data-testid="log-level">
              <option value="">level…</option>
              {LOG_LEVELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))} placeholder="max entries" style={{ width: 100 }} disabled={!armed || busy !== null} />
            <button className="mini" disabled={!armed || busy !== null || (!level && !limit)} onClick={() => setLog2({ level: level || undefined, limit: limit ? Number(limit) : undefined })} data-testid="log-level-set">
              Set
            </button>
            <button className="mini" disabled={!armed || busy !== null || log.inherits} onClick={() => setLog2({ inherit: true })} title="Drop the driver's own log settings: it uses the driver set's">
              Use the driver set's
            </button>
            <span className="muted small">Specific events are chosen from the CLI (driver.log-level set --events).</span>
          </div>
        </>
      )}

      <h4>Effective rights</h4>
      <p className="muted small">What eDirectory lets the driver object (the identity its policies act as) do on an object: entry rights, all attributes, and the attributes you name (LDAP names).</p>
      <div className="addrow tight">
        <input className="wide" value={dn} onChange={(e) => setDn(e.target.value)} placeholder="ou=users,o=data" spellCheck={false} data-testid="rights-dn" />
        <input value={attrs} onChange={(e) => setAttrs(e.target.value)} placeholder="sn, loginDisabled" spellCheck={false} style={{ width: 200 }} />
        <button className="mini" disabled={!dn || busy !== null} onClick={checkRights} data-testid="rights-go">
          Check
        </button>
      </div>
      {rights && !rights.ok && <p className="muted small">{rights.error ?? rights.text}</p>}
      {rights && rights.ok && (
        <table className="grid" data-testid="rights-table">
          <tbody>
            {(rights.rights ?? []).map((r) => (
              <tr key={r.attribute}>
                <td>{r.attribute}</td>
                <td className="small">{r.names}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** The driver set as an object: activation, servers, the notification e-mail server, user and association counts, work orders. */
function DriverSetTab({ env }: { env: string }) {
  const [admin, setAdmin] = useState<DriverSetAdmin | null>(null);
  const [mail, setMail] = useState<EmailServer | null>(null);
  const [setLog, setSetLog] = useState<LogLevel | null>(null);
  const [metrics, setMetrics] = useState<EngineMetrics | null>(null);
  const [orders, setOrders] = useState<WorkOrders | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [base, setBase] = useState("");
  const armed = confirm === env;
  const load = () => {
    setBusy("Reading…");
    Promise.all([api.vault.driverset(env), api.vault.emailServer(env), api.vault.logLevel(env), api.vault.workOrders(env)])
      .then(([a, m, l, w]) => (setAdmin(a), setMail(m), setSetLog(l), setOrders(w), setError(null)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [env]);
  const count = () => {
    setBusy("Counting…");
    api.vault
      .metrics(env, base || undefined)
      .then(setMetrics)
      .catch((e: Error) => setMetrics({ ok: false, error: e.message, text: "" }))
      .finally(() => setBusy(null));
  };
  const saveMail = () => {
    setBusy("Writing the e-mail server…");
    api.vault
      .emailServerSet(env, edit, confirm)
      .then((r) => (setLast({ ok: r.ok, text: r.text }), setEdit({}), load()))
      .catch((e: Error) => setLast({ ok: false, text: e.message }))
      .finally(() => setBusy(null));
  };
  const mailFields: [keyof EmailServer & string, string][] = [
    ["host", "Host"],
    ["port", "Port"],
    ["from", "From"],
    ["user", "User"],
    ["tls", "TLS"],
    ["timeout", "Timeout"],
    ["protocol", "Protocol"],
    ["auth", "Auth mechanisms"],
  ];
  return (
    <div className="pad" data-testid="driverset-tab">
      <div className="addrow">
        <Confirm env={env} value={confirm} onChange={setConfirm} />
        {busy && <span className="muted small">{busy}</span>}
      </div>
      {error && <div className="banner error">{error}</div>}
      {last && <div className={last.ok ? "banner ok" : "banner error"}>{last.text}</div>}

      <h4>Activation</h4>
      {admin && !admin.activation.ok && <p className="muted small">{admin.activation.error ?? admin.activation.text}</p>}
      {admin && admin.activation.ok && (
        <>
          {(admin.activation.attributes ?? []).length === 0 ? (
            <p className="muted small">No activation attributes on the driver set.</p>
          ) : (
            <table className="grid">
              <tbody>
                {(admin.activation.attributes ?? []).map((a) => (
                  <tr key={a.attribute}>
                    <td>
                      <code>{a.attribute}</code>
                    </td>
                    <td className="small">{a.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            {admin.activation.viewError ? `The engine did not answer ViewActivation (${admin.activation.viewError.replace(/^ViewActivation [^:]*: /, "")}).` : admin.activation.activation ? "The engine reports an activation document (see the CLI's driverset.activation for it)." : "The engine reports no activation document."} A vendor credential is applied from the CLI (driverset.activation apply).
          </p>
        </>
      )}

      <h4>Servers</h4>
      {admin && admin.servers.ok && (
        <p className="small">
          {(admin.servers.servers ?? []).length === 0 ? <span className="muted">None listed: no engine runs this set.</span> : (admin.servers.servers ?? []).map((s) => <code key={s} style={{ marginRight: 12 }}>{s}</code>)}
          <br />
          <span className="muted">
            The server this connection reaches {admin.servers.connectedServerRuns ? `runs ${admin.servers.connectedServerRuns}` : "runs no driver set"}. Servers are associated from the CLI (driverset.servers add|remove).
          </span>
        </p>
      )}

      <h4>Log level of the driver set</h4>
      {setLog && setLog.ok && (
        <p className="small">
          {setLog.levelName ? <b>{setLog.levelName}</b> : <span className="muted">No log level set</span>}
          {setLog.events && setLog.events.length > 0 ? <span className="muted"> · events {setLog.events.join(" ")}</span> : null}
          {setLog.limit != null ? <span className="muted"> · keeps {setLog.limit} entries{setLog.limit === 0 ? " (logging off for the set)" : ""}</span> : null}
        </p>
      )}

      <h4>Notification e-mail server</h4>
      {mail && !mail.ok && <p className="muted small">{mail.error ?? mail.text}</p>}
      {mail && mail.ok && (
        <>
          <p className="muted small">
            <code>{mail.dn}</code> · password {mail.passwordSet ? "set" : "not set"} (set from the CLI and the secrets file: vault.email-server set --password-key)
          </p>
          <table className="grid" data-testid="email-table">
            <tbody>
              {mailFields.map(([k, label]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td>
                    <input value={edit[k] ?? String(mail[k] ?? "")} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} disabled={!armed || busy !== null} spellCheck={false} style={{ width: 320 }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="mini" disabled={!armed || busy !== null || Object.keys(edit).length === 0} onClick={saveMail} data-testid="email-save">
            Save
          </button>
        </>
      )}

      <h4>Users and associations</h4>
      <div className="addrow tight">
        <input className="wide" value={base} onChange={(e) => setBase(e.target.value)} placeholder="search base (empty: the whole tree)" spellCheck={false} />
        <button className="mini" disabled={busy !== null} onClick={count} data-testid="metrics-go">
          Count
        </button>
        <span className="muted small">Counts only; nothing is read beyond the DNs. The enabled figure is the console's licensing count.</span>
      </div>
      {metrics && !metrics.ok && <p className="muted small">{metrics.error ?? metrics.text}</p>}
      {metrics && metrics.ok && (
        <>
          <p className="small">
            {metrics.users} users · {metrics.associated} with an association · {metrics.enabled} of those enabled
          </p>
          <table className="grid" data-testid="metrics-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Processed</th>
                <th>Pending</th>
                <th>Manual</th>
                <th>Migrate</th>
                <th>Disabled</th>
              </tr>
            </thead>
            <tbody>
              {(metrics.drivers ?? []).map((d) => (
                <tr key={d.dn}>
                  <td>{d.name}</td>
                  <td>{d.processed}</td>
                  <td>{d.pending}</td>
                  <td>{d.manual}</td>
                  <td>{d.migrate}</td>
                  <td>{d.disabled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h4>Work orders</h4>
      {orders && orders.ok && (orders.workOrders ?? []).length === 0 && <p className="muted small">None under the driver set.</p>}
      {orders && orders.ok && (orders.workOrders ?? []).length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Work order</th>
              <th>Status</th>
              <th>Due</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {(orders.workOrders ?? []).map((w) => (
              <tr key={w.dn}>
                <td>{w.name}</td>
                <td>{w.status}</td>
                <td className="small">{w.due}</td>
                <td className="small">{w.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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

/** The jobs of the driver set as the engine runs them (job.list): start or abort one behind the typed environment name. */
function Jobs({ env, onFix }: { env: string; onFix: () => void }) {
  const [data, setData] = useState<VaultJobs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => {
    setBusy("Reading…");
    api.vault
      .jobs(env)
      .then((j) => (setData(j), setError(null)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  useEffect(load, [env]);
  const act = (job: string, driver: string | null, action: "start" | "abort") => {
    setBusy(`${action} ${job}…`);
    api.vault
      .job(env, job, driver, action, confirm)
      .then((r) => (setLast({ ok: r.ok, text: r.text }), load()))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  const armed = confirm === env;
  return (
    <div className="pad">
      <div className="addrow">
        <button onClick={load} disabled={busy !== null} data-testid="jobs-refresh">
          Refresh
        </button>
        <Confirm env={env} value={confirm} onChange={setConfirm} />
        {busy && <span className="muted">{busy}</span>}
        <span className="muted small">The engine's jobs: a driver's triggers and health checks, the set's statistics job. Start runs one now; abort stops a running one.</span>
      </div>
      {error && <VaultError message={error} onFix={onFix} />}
      {last && <div className={last.ok ? "banner" : "banner error"} data-testid="jobs-last">{last.text}</div>}
      {data && data.jobs.length === 0 && <p className="muted">No jobs in {env}.</p>}
      {data && data.jobs.length > 0 && (
        <table className="grid" data-testid="jobs-table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Owner</th>
              <th>Class</th>
              <th>Running</th>
              <th>Configuration</th>
              <th>Scheduled</th>
              <th>Next run</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.jobs.map((j) => (
              <tr key={j.dn}>
                <td>
                  <code>{j.name}</code>
                  {j.disabled && <span className="pill warn">disabled</span>}
                </td>
                <td className="small">{j.owner}</td>
                <td className="small muted">{j.javaClass.replace(/^.*\./, "")}</td>
                <td>
                  <span className={"pill " + (j.running === "running" ? "ok" : "")}>{j.running}</span>
                </td>
                <td className="small">{j.config}</td>
                <td className="small">{j.scheduled}</td>
                <td className="small">{j.nextRun ? j.nextRun.replace("T", " ").slice(0, 16) : "—"}</td>
                <td className="right">
                  <button disabled={!armed || busy !== null || j.running === "running"} onClick={() => act(j.name, j.driver, "start")} data-testid={"job-start-" + j.name}>
                    Start
                  </button>{" "}
                  <button disabled={!armed || busy !== null || j.running !== "running"} onClick={() => act(j.name, j.driver, "abort")}>
                    Abort
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

/** One object as the vault has it (the console's object inspector): classes, associations across drivers, password-sync status. */
/** The driver set's entitlement policies as the vault holds them: priority, the directory's member count, the grants (`rbe.list`, `rbe.members`). */
function Policies({ env }: { env: string }) {
  const [data, setData] = useState<VaultPolicies | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [members, setMembers] = useState<PolicyMembers | null>(null);
  useEffect(() => {
    setBusy(true);
    api.vault
      .rbe(env)
      .then((p) => (setData(p), setError(null)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }, [env]);
  const show = (name: string) => {
    if (open === name) {
      setOpen(null);
      return;
    }
    setOpen(name);
    setMembers(null);
    api.vault
      .rbeMembers(env, name)
      .then(setMembers)
      .catch((e: Error) => setMembers({ ok: false, error: e.message, text: "" }));
  };
  return (
    <div className="pad">
      <p className="muted small">
        The role-based entitlement policies of the Entitlements Service driver, as {env} holds them: the container's priority order, the members the directory computes for each dynamic group, and what each grants. Edit them in the tree (<code>rbe-policies/</code>) and deploy; the driver re-reads them when it restarts.
      </p>
      {busy && <p className="muted small">Reading…</p>}
      {error && <div className="banner error">{error}</div>}
      {data && !data.container && <p className="muted small">No entitlement policy container in the driver set.</p>}
      {data && data.container && (
        <>
          <p className="small">
            <code>{data.container}</code>
          </p>
          {data.policies.length === 0 ? (
            <p className="muted small">The container holds no policies.</p>
          ) : (
            <table className="grid" data-testid="rbe-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Policy</th>
                  <th>Members</th>
                  <th>Grants</th>
                  <th>Membership</th>
                </tr>
              </thead>
              <tbody>
                {data.policies.map((p) => (
                  <>
                    <tr key={p.dn}>
                      <td>{p.priority ?? "-"}</td>
                      <td>
                        <button className="link" onClick={() => show(p.name)} title="The members the directory computes">
                          {p.name}
                        </button>
                      </td>
                      <td>{p.members}</td>
                      <td className="small">
                        {p.grants.length === 0 ? <span className="muted">none</span> : p.grants.map((g, i) => (
                          <div key={i}>
                            <code>{g.entitlement}</code>
                            {g.ref && g.ref !== "<ref/>" ? <span className="muted"> {g.ref}</span> : null}
                          </div>
                        ))}
                      </td>
                      <td className="small">
                        <code>{p.memberQuery || "static only"}</code>
                      </td>
                    </tr>
                    {open === p.name && (
                      <tr key={p.dn + "-members"}>
                        <td colSpan={5} className="small">
                          {!members ? (
                            <span className="muted">Reading…</span>
                          ) : !members.ok ? (
                            <span className="muted">{members.error ?? members.text}</span>
                          ) : (members.members ?? []).length === 0 ? (
                            <span className="muted">No members right now.</span>
                          ) : (
                            <ul className="plain">
                              {(members.members ?? []).map((m) => (
                                <li key={m}>
                                  <code>{m}</code>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

/** Ask the connected system a question through a running driver (`driver.query`): the engine's query verb, the shim's instances. */
function AskApplication({ env }: { env: string }) {
  const [driver, setDriver] = useState("");
  const [className, setClassName] = useState("User");
  const [scope, setScope] = useState("subtree");
  const [dn, setDn] = useState("");
  const [search, setSearch] = useState("");
  const [readAttrs, setReadAttrs] = useState("");
  const [confirm, setConfirm] = useState("");
  const [data, setData] = useState<AppQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = () => {
    setBusy(true);
    setError(null);
    api.vault
      .query(env, {
        driver,
        className: className || undefined,
        scope,
        dn: dn || undefined,
        search: search.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean),
        readAttrs: readAttrs.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean),
        confirm: confirm || undefined,
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="block" data-testid="ask-application">
      <h4>Ask the application</h4>
      <p className="muted small">The same question to the connected system, through a running driver: the engine's query verb goes down the subscriber channel and the shim answers. It takes the driver's channel while it runs; a production environment wants its name typed.</p>
      <div className="addrow">
        <input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="driver" spellCheck={false} style={{ width: 180 }} data-testid="ask-driver" />
        <input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="class (User)" spellCheck={false} style={{ width: 120 }} />
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="subtree">subtree</option>
          <option value="subordinates">subordinates</option>
          <option value="entry">entry</option>
        </select>
        <input className="wide" value={dn} onChange={(e) => setDn(e.target.value)} placeholder="from DN (optional; LDAP form is fine)" spellCheck={false} />
      </div>
      <div className="addrow">
        <input className="wide" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search: name=value, name=value" spellCheck={false} />
        <input className="wide" value={readAttrs} onChange={(e) => setReadAttrs(e.target.value)} placeholder="read: attr, attr (empty: every attribute; none: just the match)" spellCheck={false} />
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={env} spellCheck={false} style={{ width: 120 }} title="The environment's name, when it is not a dev one" />
        <button onClick={ask} disabled={!driver || busy} data-testid="ask-go">
          {busy ? "Asking…" : "Ask"}
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {data && !data.ok && <div className="banner error">{data.error ?? data.text}</div>}
      {data && data.ok && (
        <div data-testid="ask-result">
          <p className="small muted">
            {data.count} instance(s){data.status ? ` · ${data.status}` : ""}
          </p>
          {(data.instances ?? []).map((inst, i) => (
            <div key={i} className="block">
              <p className="small">
                <b>{inst.className || "instance"}</b> <code>{inst.srcDn}</code>
                {inst.association ? <span className="muted"> [{inst.association}]</span> : null}
              </p>
              {Object.keys(inst.attrs).length > 0 && (
                <table className="grid">
                  <tbody>
                    {Object.entries(inst.attrs).map(([k, vs]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="small">{vs.join(" | ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
      <AskApplication env={env} />
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

