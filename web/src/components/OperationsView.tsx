import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../api";
import type { OpResult, OpSpec } from "../types";
import { OpOutcome } from "./ReviewDialog";

/**
 * Every edit operation the core registers, runnable from a form generated out of its declared
 * arguments. This is the whole editing surface in its rawest form: the dedicated editors of
 * later phases are friendlier front ends to the same calls. Dry run first; apply only after.
 */
export function OperationsView({ revision, onDone }: { revision: string; onDone: () => void }) {
  const [ops, setOps] = useState<OpSpec[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<OpSpec | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<OpResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .catalog()
      .then((c) => setOps(c.operations))
      .catch((e: Error) => setError(e.message));
  }, []);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? ops.filter((o) => o.name.toLowerCase().includes(f) || o.help.toLowerCase().includes(f)) : ops;
  }, [ops, filter]);

  const groups = useMemo(() => {
    const m = new Map<string, OpSpec[]>();
    for (const o of shown) {
      const g = o.name.split(".")[0] ?? o.name;
      m.set(g, [...(m.get(g) ?? []), o]);
    }
    return [...m.entries()];
  }, [shown]);

  const pick = (o: OpSpec) => {
    setSelected(o);
    setValues({});
    setResult(null);
    setError(null);
  };

  const run = async (dryRun: boolean) => {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    const args: Record<string, string> = {};
    const files: Record<string, string> = {};
    for (const a of selected.args) {
      const v = values[a.name];
      if (v !== undefined && v !== "") {
        (a.file ? files : args)[a.name] = v;
      }
    }
    try {
      const r = await api.run(selected.name, { args, files, dryRun, revision });
      setResult(r);
      if (!dryRun && r.ok) {
        onDone();
      }
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError && e.status === 409 ? "The tree changed on disk since this page last loaded it. Run the dry run again." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ops">
      <div className="opslist">
        <div className="panelhead">
          <strong>Operations</strong>
          <span className="count">{ops.length}</span>
        </div>
        <input className="filter" placeholder="Filter (e.g. gcv, rule, policy.link)" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="scroll">
          {groups.map(([g, list]) => (
            <details key={g} open={filter !== "" || groups.length <= 4}>
              <summary>
                {g} <span className="count">{list.length}</span>
              </summary>
              <ul>
                {list.map((o) => (
                  <li key={o.name}>
                    <button className={selected?.name === o.name ? "leaf active" : "leaf"} onClick={() => pick(o)} title={o.help}>
                      {o.name}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </div>
      <div className="opsform">
        {!selected ? (
          <div className="pad">
            <h2>Operations</h2>
            <p className="muted">
              The core's typed edit operations, the same ones the <code>idm</code> CLI and the MCP server run. Each loads the tree, applies the change, validates the result, and writes only if it introduced no error.
            </p>
            <p className="muted">Pick one on the left. Run it dry first; the result says what would change.</p>
          </div>
        ) : (
          <div className="pad">
            <div className="kicker">operation</div>
            <h2>{selected.name}</h2>
            <p className="muted">{selected.help}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(true);
              }}
            >
              {selected.args.map((a) => (
                <label key={a.name} className="field">
                  <span>
                    {a.name}
                    {a.required ? <em> required</em> : ""}
                  </span>
                  {a.file ? (
                    <textarea rows={8} spellCheck={false} placeholder="content (the CLI takes a file here; the page sends the text)" value={values[a.name] ?? ""} onChange={(e) => setValues({ ...values, [a.name]: e.target.value })} />
                  ) : (
                    <input value={values[a.name] ?? ""} onChange={(e) => setValues({ ...values, [a.name]: e.target.value })} />
                  )}
                  <small className="muted">{a.help}</small>
                </label>
              ))}
              <div className="actions">
                <button type="submit" disabled={busy}>
                  Dry run
                </button>
                <button type="button" className="primary" disabled={busy || !result || !result.ok || !result.dryRun} onClick={() => void run(false)} title="Available after a dry run that passed">
                  Apply
                </button>
              </div>
            </form>
            {error && <p className="err-text">{error}</p>}
            {result && <OpOutcome result={result} />}
          </div>
        )}
      </div>
    </div>
  );
}
