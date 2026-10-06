import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { OpCall, OpSpec } from "../types";
import { ReviewDialog } from "./ReviewDialog";

/**
 * Every edit operation the core registers, runnable from a form generated out of its declared
 * arguments. This is the whole editing surface in its rawest form: the dedicated editors of
 * later phases are friendlier front ends to the same calls. Dry run first; apply only after.
 */
export function OperationsView({ onDone }: { onDone: () => void }) {
  const [ops, setOps] = useState<OpSpec[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<OpSpec | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<OpCall | null>(null);
  const [done, setDone] = useState<string | null>(null);

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
    setDone(null);
    setError(null);
  };

  const call = (): OpCall | null => {
    if (!selected) {
      return null;
    }
    const args: Record<string, string> = {};
    const files: Record<string, string> = {};
    for (const a of selected.args) {
      const v = values[a.name];
      if (v !== undefined && v !== "") {
        (a.file ? files : args)[a.name] = v;
      }
    }
    return { name: selected.name, args, files, label: `${selected.name} ${Object.entries(args).map(([k, v]) => `${k}=${v.replace(/\n/g, ", ")}`).join(" ")}` };
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
            <p className="muted">Pick one on the left. Review shows what would change, file by file, before anything is written.</p>
          </div>
        ) : (
          <div className="pad">
            <div className="kicker">operation</div>
            <h2>{selected.name}</h2>
            <p className="muted">{selected.help}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setDone(null);
                setReview(call());
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
                <button type="submit" className="primary">
                  Review
                </button>
              </div>
            </form>
            {error && <p className="err-text">{error}</p>}
            {done && <p className="ok-text">{done}</p>}
            {review && (
              <ReviewDialog
                title={`Review ${selected.name}`}
                ops={[review]}
                onClose={() => setReview(null)}
                onApplied={(r) => {
                  setReview(null);
                  setDone(`Written: ${r.changedFiles.length} file(s) changed${r.deletedFiles.length ? `, ${r.deletedFiles.length} deleted` : ""}.`);
                  onDone();
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
