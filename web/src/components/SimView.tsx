import { useCallback, useEffect, useState } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { api } from "../api";
import { monacoTheme } from "../monaco";
import { prettyXml } from "../prettyxml";
import type { SimCaseFiles, SimCases, SimDetail, SimRun, SimStage } from "../types";

const SAMPLE = `<nds dtdversion="4.0">
  <input>
    <add class-name="User" src-dn="\\TREE\\org\\people\\jdoe">
      <add-attr attr-name="Surname">
        <value type="string">Doe</value>
      </add-attr>
    </add>
  </input>
</nds>
`;

/**
 * The simulator: a corpus of cases run through the tree's policies by the engine's own classes.
 * Run the corpus for a verdict per case; open a case to see its document after every policy,
 * with that policy's trace; try another input without saving it; record the output a case
 * should keep producing.
 */
export function SimView({ drivers, revision }: { drivers: string[]; revision: string }) {
  const [cases, setCases] = useState<SimCases | null>(null);
  const [envs, setEnvs] = useState<string[]>([]);
  const [env, setEnv] = useState("");
  const [run, setRun] = useState<SimRun | null>(null);
  const [ranAt, setRanAt] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.sim
      .cases()
      .then((c) => {
        setCases(c);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    // the stages with values of their own: the environments file's, and any with an overrides file
    Promise.all([api.vault.environments().catch(() => null), api.overrides().catch(() => null)]).then(([v, o]) => {
      setEnvs([...new Set([...(o?.environments ?? []), ...(v?.environments.map((e) => e.name) ?? [])])]);
    });
  }, [revision]);

  const runAll = () => {
    setBusy(true);
    setError(null);
    api.sim
      .run(env || null)
      .then((r) => {
        setRun(r);
        setRanAt(revision);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (!cases) {
    return error ? <div className="banner error">{error}</div> : <p className="muted pad">Loading…</p>;
  }
  const verdict = (name: string) => run?.cases.find((c) => c.name === name)?.outcome;

  return (
    <div className="view sim">
      <div className="viewhead">
        <h2>Simulator</h2>
        <label className="field">
          <em>Values of</em>
          <select value={env} onChange={(e) => (setEnv(e.target.value), setRun(null))} data-testid="sim-env">
            <option value="">the tree (base values)</option>
            {envs.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <button onClick={runAll} disabled={busy || cases.cases.length === 0} data-testid="sim-run-all">
          {busy ? "Running…" : "Run all"}
        </button>
        {run && (
          <span data-testid="sim-summary">
            <span className={run.fail + run.error > 0 ? "pill err" : "pill ok"}>{run.pass} pass</span> <span className={run.fail > 0 ? "pill err" : "pill"}>{run.fail} fail</span>{" "}
            <span className={run.error > 0 ? "pill err" : "pill"}>{run.error} error</span> <span className="pill">{run.skip} not recorded</span>
            {ranAt !== revision && <span className="muted small"> (the tree changed since this run)</span>}
          </span>
        )}
        <span className="spacer" />
        <button onClick={() => (setCreating(true), setSelected(null))} data-testid="sim-new">
          New case
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {run?.notes.map((n, i) => (
        <p key={i} className="muted small pad-x">
          {n}
        </p>
      ))}
      <div className="simbody">
        <div className="simlist">
          <p className="muted small" title={cases.dir}>
            {cases.exists ? `${cases.cases.length} case${cases.cases.length === 1 ? "" : "s"} in ` : "No cases yet. They will be kept in "}
            <code>{shorten(cases.dir)}</code>
          </p>
          <ul className="filelist" data-testid="sim-cases">
            {cases.cases.map((c) => (
              <li key={c.name}>
                <button className={selected === c.name ? "leaf active" : "leaf"} onClick={() => (setSelected(c.name), setCreating(false))}>
                  <span className={"pill " + pillOf(verdict(c.name))}>{verdict(c.name) ?? (c.hasExpected ? "·" : "new")}</span> {c.name}
                  <span className="muted small">
                    {" "}
                    {c.driver ?? "no driver"} · {c.channel}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="simmain">
          {creating ? (
            <NewCase
              drivers={drivers}
              taken={cases.cases.map((c) => c.name)}
              onDone={(name) => {
                setCreating(false);
                load();
                setSelected(name);
              }}
              onCancel={() => setCreating(false)}
            />
          ) : selected ? (
            <CaseView key={selected} name={selected} env={env} envs={envs} revision={revision} gate={run?.cases.find((c) => c.name === selected) ?? null} onChanged={load} />
          ) : (
            <p className="muted pad">
              {cases.cases.length === 0
                ? "A case is an input document for one driver and channel. Create one, run it, and record its output: from then on Run all tells you when a change to the tree alters it."
                : "Choose a case, or run them all."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function pillOf(outcome: string | undefined): string {
  return outcome === "pass" ? "ok" : outcome === "fail" || outcome === "error" ? "err" : "";
}

function shorten(path: string): string {
  const parts = path.split("/");
  return parts.length > 4 ? "…/" + parts.slice(-3).join("/") : path;
}

function NewCase({ drivers, taken, onDone, onCancel }: { drivers: string[]; taken: string[]; onDone: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [driver, setDriver] = useState(drivers[0] ?? "");
  const [channel, setChannel] = useState("subscriber");
  const [input, setInput] = useState(SAMPLE);
  const [error, setError] = useState<string | null>(null);
  const clash = taken.includes(name);
  const save = () => {
    api.sim
      .save(name, input, driver, channel)
      .then(() => onDone(name))
      .catch((e: Error) => setError(e.message));
  };
  return (
    <div className="pad simcase">
      <h3>New case</h3>
      <div className="addrow">
        <label className="field">
          <em>Name</em>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="add-user" spellCheck={false} data-testid="sim-new-name" />
        </label>
        <label className="field">
          <em>Driver</em>
          <select value={driver} onChange={(e) => setDriver(e.target.value)} data-testid="sim-new-driver">
            {drivers.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <em>Channel</em>
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="subscriber">subscriber</option>
            <option value="publisher">publisher</option>
          </select>
        </label>
        <button onClick={save} disabled={!name || clash || !driver} data-testid="sim-new-save">
          Create
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
      {clash && <p className="err-text small">A case of that name exists.</p>}
      {error && <div className="banner error">{error}</div>}
      <p className="muted small">The input: the XDS document the channel receives.</p>
      <div className="editor">
        <Editor language="xml" value={input} theme={monacoTheme()} onChange={(v) => setInput(v ?? "")} options={{ minimap: { enabled: false }, scrollBeyondLastLine: false }} />
      </div>
    </div>
  );
}

type Pane = "stages" | "input" | "expected" | "trace";

function CaseView({
  name,
  env,
  envs,
  revision,
  gate,
  onChanged,
}: {
  name: string;
  env: string;
  envs: string[];
  revision: string;
  gate: { outcome: string; detail: string } | null;
  onChanged: () => void;
}) {
  const [files, setFiles] = useState<SimCaseFiles | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [detail, setDetail] = useState<SimDetail | null>(null);
  const [ranWith, setRanWith] = useState<"saved" | "draft">("saved");
  const [pane, setPane] = useState<Pane>("stages");
  const [stage, setStage] = useState(0);
  const [against, setAgainst] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const dirty = draft !== null && files !== null && draft !== (files.input ?? "");

  const runCase = useCallback(
    (withDraft: string | null, compare: string | null) => {
      setBusy("Running…");
      setError(null);
      api.sim
        .detail(name, { env: env || null, ...(withDraft === null ? {} : { input: withDraft }), ...(compare === null ? {} : { against: compare }) })
        .then((d) => {
          setDetail(d);
          setRanWith(withDraft === null ? "saved" : "draft");
          setStage((s) => (d.stages && s < d.stages.length ? s : 0));
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setBusy(null));
    },
    [name, env],
  );

  useEffect(() => {
    let gone = false;
    api.sim
      .files(name)
      .then((f) => {
        if (!gone) {
          setFiles(f);
          setDraft(f.input ?? "");
        }
      })
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [name]);
  // a saved case follows the tree: any edit reruns it
  useEffect(() => {
    runCase(null, against);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, env, revision]);

  const save = () => {
    if (draft === null) {
      return;
    }
    setBusy("Saving…");
    api.sim
      .save(name, draft)
      .then(() => api.sim.files(name))
      .then((f) => {
        setFiles(f);
        setNote("Input saved.");
        runCase(null, against);
      })
      .catch((e: Error) => (setError(e.message), setBusy(null)));
  };
  const record = () => {
    setBusy("Recording…");
    api.sim
      .record(name)
      .then((r) => {
        setNote(`Recorded: ${r.wrote.join(", ")}. The case now passes while the tree keeps producing this output.`);
        onChanged();
        return api.sim.files(name).then(setFiles);
      })
      .then(() => runCase(null, against))
      .catch((e: Error) => (setError(e.message), setBusy(null)));
  };

  if (!files) {
    return error ? <div className="banner error">{error}</div> : <p className="muted pad">Loading…</p>;
  }
  const stages: SimStage[] = detail?.stages ?? [];
  const current = stages[stage];
  const outcome = detail?.outcome;

  return (
    <div className="simcase">
      <div className="viewhead">
        <h3>{name}</h3>
        <span className="muted small">
          {files.driver ?? "no driver"} · {files.channel}
        </span>
        {outcome && (
          <span className={"pill " + pillOf(outcome)} data-testid="sim-outcome">
            {outcome === "skip" ? "not recorded" : outcome}
          </span>
        )}
        {ranWith === "draft" && <span className="pill warn">run with the unsaved input</span>}
        {busy && <span className="muted">{busy}</span>}
        <span className="spacer" />
        <div className="tabs">
          {(["stages", "input", "expected", "trace"] as Pane[]).map((p) => (
            <button key={p} className={pane === p ? "tab active" : "tab"} onClick={() => setPane(p)} data-testid={"sim-tab-" + p}>
              {p === "stages" ? "Stages" : p === "input" ? (dirty ? "Input •" : "Input") : p === "expected" ? "Expected" : "Trace"}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
      {note && <p className="ok-text small pad-x">{note}</p>}
      {detail && !detail.ok && (
        <div className="banner error" data-testid="sim-error">
          The case did not run: {detail.error}
        </div>
      )}
      {detail?.notes.map((n, i) => (
        <p key={i} className="muted small pad-x">
          {n}
        </p>
      ))}
      {detail?.warnings?.map((w, i) => (
        <div key={i} className="banner warn">
          {w}
        </div>
      ))}
      {gate && gate.outcome !== "pass" && gate.detail && pane === "stages" && ranWith === "saved" && outcome !== "pass" && <pre className="outcome err-text">{detail?.outcomeDetail || gate.detail}</pre>}

      {pane === "stages" && detail?.ok && (
        <div className="simstages">
          <ol className="stagelist" data-testid="sim-stages">
            {stages.map((s, i) => {
              const cmp = detail.against?.stages?.find((x) => x.name === s.name);
              return (
                <li key={i}>
                  <button className={i === stage ? "leaf active" : "leaf"} onClick={() => setStage(i)}>
                    <span className={s.error ? "pill err" : s.changed ? "pill warn" : "pill"}>{s.error ? "error" : s.changed ? "changed" : "same"}</span> {s.name}
                    {cmp && !cmp.same && <span className="pill err"> differs</span>}
                  </button>
                </li>
              );
            })}
            {stages.length === 0 && <li className="muted small">No policies ran: the channel has none linked.</li>}
          </ol>
          <div className="stagepane">
            <div className="addrow tight">
              <label className="field">
                <em>Compare with the values of</em>
                <select
                  value={against ?? "__none"}
                  onChange={(e) => {
                    const v = e.target.value === "__none" ? null : e.target.value;
                    setAgainst(v);
                    runCase(ranWith === "draft" ? draft : null, v);
                  }}
                  data-testid="sim-against"
                >
                  <option value="__none">nothing</option>
                  {env !== "" && <option value="">the tree (base values)</option>}
                  {envs
                    .filter((e) => e !== env)
                    .map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                </select>
              </label>
              {detail.against &&
                (detail.against.error ? (
                  <span className="err-text">{detail.against.error}</span>
                ) : detail.against.same ? (
                  <span className="ok-text">Same result with those values.</span>
                ) : (
                  <span className="err-text">
                    Differs, first at {detail.against.firstDivergesAt ?? "the final output"}. {detail.against.finalDetail}
                  </span>
                ))}
            </div>
            {current && (
              <>
                {current.error && <div className="banner error">{current.error}</div>}
                <p className="muted small">
                  {current.name}: the document before (left) and after (right).
                  {current.queries.length > 0 && ` ${current.queries.length} quer${current.queries.length === 1 ? "y" : "ies"}.`}
                  {current.commands.length > 0 && ` ${current.commands.length} command${current.commands.length === 1 ? "" : "s"} sent.`}
                </p>
                <div className="stagediff">
                  <DiffEditor
                    language="xml"
                    original={prettyXml(current.input)}
                    modified={prettyXml(current.output)}
                    theme={monacoTheme()}
                    options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false }}
                  />
                </div>
                <details className="stagetrace">
                  <summary>This policy's trace</summary>
                  <pre className="outcome">{current.trace || "(nothing traced)"}</pre>
                  {[...current.queries, ...current.commands].map((x, i) => (
                    <pre key={i} className="outcome">
                      {prettyXml(x)}
                    </pre>
                  ))}
                </details>
              </>
            )}
          </div>
        </div>
      )}

      {pane === "input" && (
        <div className="pad simcase">
          <div className="addrow">
            <button onClick={() => runCase(draft, against)} disabled={busy !== null || !dirty} title="Run the tree's policies on this text without saving it" data-testid="sim-try">
              Run without saving
            </button>
            <button onClick={save} disabled={busy !== null || !dirty} data-testid="sim-save">
              Save input
            </button>
            <button onClick={() => setDraft(files.input ?? "")} disabled={!dirty}>
              Revert
            </button>
          </div>
          <div className="editor">
            <Editor language="xml" value={draft ?? ""} theme={monacoTheme()} onChange={(v) => setDraft(v ?? "")} options={{ minimap: { enabled: false }, scrollBeyondLastLine: false }} />
          </div>
        </div>
      )}

      {pane === "expected" && (
        <div className="pad simcase">
          <div className="addrow">
            <button onClick={record} disabled={busy !== null || dirty || !detail?.ok} title={dirty ? "Save or revert the input first" : "Keep the current output (base values) as what this case expects"} data-testid="sim-record">
              {files.expected ? "Record again: accept the current output" : "Record the current output"}
            </button>
            <span className="muted small">
              {files.expected ? "Left: what the case recorded. Right: what the tree produces now." : "Nothing recorded yet, so the case cannot pass or fail."}
              {files.assertions ? " This case also has expected.assertions." : ""}
            </span>
          </div>
          <div className="stagediff">
            <DiffEditor
              language="xml"
              original={files.expected ? prettyXml(files.expected) : ""}
              modified={detail?.final ? prettyXml(detail.final) : ""}
              theme={monacoTheme()}
              options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false }}
            />
          </div>
        </div>
      )}

      {pane === "trace" && <pre className="tracebox simtrace">{detail?.trace || "(no trace)"}</pre>}
    </div>
  );
}
