import { useEffect, useState } from "react";
import { api } from "../api";
import { usePending } from "../pending";
import type { OverridesData } from "../types";
import { PendingBar } from "./PendingBar";

/**
 * Every value that differs per stage, as one matrix: a row per key, a column per environment,
 * the tree's base value beside them. An empty cell means "this stage takes the base".
 */
export function OverridesView({ revision, canEdit, onSaved }: { revision: string; canEdit: boolean; onSaved: () => void }) {
  const [data, setData] = useState<OverridesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extraEnvs, setExtraEnvs] = useState<string[]>([]);
  const [newEnv, setNewEnv] = useState("");
  const [draft, setDraft] = useState({ env: "", key: "", value: "" });
  const pending = usePending();

  useEffect(() => {
    let gone = false;
    api
      .overrides()
      .then((d) => !gone && (setData(d), setError(null)))
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [revision]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data) {
    return <p className="muted pad">Loading…</p>;
  }
  const envs = [...new Set([...data.environments, ...extraEnvs])];

  const cell = (key: string, env: string): string => {
    const staged = pending.ops.find((o) => o.key === `ovr:${env}:${key}`);
    if (staged) {
      return staged.name === "override.remove" ? "" : (staged.args.value ?? "");
    }
    return data.overrides.find((o) => o.key === key)?.values[env] ?? "";
  };

  const set = (key: string, env: string, value: string) => {
    const stored = data.overrides.find((o) => o.key === key)?.values[env] ?? "";
    const pkey = `ovr:${env}:${key}`;
    if (value === stored) {
      pending.put(pkey, null);
    } else if (value === "") {
      pending.put(pkey, { name: "override.remove", args: { env, key }, label: `${env}: ${key} back to the base value` });
    } else {
      pending.put(pkey, { name: "override.set", args: { env, key, value }, label: `${env}: ${key} = ${value}` });
    }
  };

  return (
    <div className="view">
      <div className="viewhead">
        <div>
          <div className="kicker">overrides/&lt;env&gt;.properties</div>
          <h2>Values that differ per stage</h2>
          <div className="muted small">A deploy to an environment applies its column to the tree's base value. The base itself is edited where the value lives.</div>
        </div>
      </div>
      <PendingBar pending={pending} title="Review override changes" onSaved={onSaved} />
      {!canEdit && <div className="banner warn">Read-only: this DirXMLDev has no override operations (DirXMLDev 0.8.0 has them).</div>}
      <div className="pad scroll">
        {data.overrides.length === 0 && envs.length === 0 ? (
          <p className="muted">No overrides: every environment gets the tree's values. Add one below, or from a driver's GCV table.</p>
        ) : (
          <table className="defs">
            <thead>
              <tr>
                <th>Key</th>
                <th>Base value</th>
                {envs.map((e) => (
                  <th key={e}>{e}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.overrides.map((o) => (
                <tr key={o.key}>
                  <td>
                    <code>{o.key}</code>
                    {!o.resolved && <div className="err-text small">{o.problem}</div>}
                  </td>
                  <td className="muted">{o.base ?? "—"}</td>
                  {envs.map((e) => (
                    <td key={e} className="vcell">
                      <input value={cell(o.key, e)} placeholder="base" disabled={!canEdit} className={pending.has(`ovr:${e}:${o.key}`) ? "changed" : ""} onChange={(ev) => set(o.key, e, ev.target.value)} spellCheck={false} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <>
            <div className="addrow">
              <strong className="small">New override</strong>
              <input placeholder="environment" value={draft.env} onChange={(e) => setDraft({ ...draft, env: e.target.value })} list="envs" />
              <datalist id="envs">
                {envs.map((e) => (
                  <option key={e} value={e} />
                ))}
              </datalist>
              <input className="wide" placeholder="key: drivers/<driver>.gcv.<name>, .shim.<name>, .ecv.<name>, .shim-auth-server, driverset.gcv.<name>" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
              <input placeholder="value" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
              <button
                disabled={!draft.env.trim() || !draft.key.trim() || !draft.value}
                onClick={() => {
                  pending.put(`ovr:${draft.env.trim()}:${draft.key.trim()}`, { name: "override.set", args: { env: draft.env.trim(), key: draft.key.trim(), value: draft.value }, label: `${draft.env.trim()}: ${draft.key.trim()} = ${draft.value}` });
                  setDraft({ env: draft.env, key: "", value: "" });
                }}
              >
                Add
              </button>
            </div>
            <div className="addrow">
              <strong className="small">Environment</strong>
              <input placeholder="name (e.g. prd)" value={newEnv} onChange={(e) => setNewEnv(e.target.value)} />
              <button
                disabled={!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(newEnv) || envs.includes(newEnv)}
                onClick={() => {
                  setExtraEnvs([...extraEnvs, newEnv]);
                  setNewEnv("");
                }}
              >
                Add column
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
