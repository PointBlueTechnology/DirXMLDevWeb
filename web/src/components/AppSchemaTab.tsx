import { useState } from "react";
import { api } from "../api";
import { useAppSchema } from "../schema";
import { EnvPicker, useEnvironment } from "../env";
import type { SchemaActionResult } from "../types";

/** What the shim says it can synchronize: its classes and attributes, read through the engine on request (the driver stopped). */
export function AppSchemaTab({ driver, revision, onSaved }: { driver: string; revision: string; onSaved: () => void }) {
  const schema = useAppSchema(driver, revision);
  const { envs, env, setEnv } = useEnvironment();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SchemaActionResult | null>(null);
  const [filter, setFilter] = useState("");
  const refresh = () => {
    setBusy(true);
    setResult(null);
    api
      .vault.refreshAppSchema(env, driver)
      .then((r) => {
        setResult(r);
        if (r.ok) {
          onSaved();
        }
      })
      .catch((e: Error) => setResult({ ok: false, refusal: e.message, done: [], skipped: [], failures: [], text: "" }))
      .finally(() => setBusy(false));
  };
  const q = filter.trim().toLowerCase();
  return (
    <div className="pad" data-testid="app-schema">
      <div className="addrow">
        {schema?.present ? (
          <span className="small">
            <strong>{schema.classes.length}</strong> classes from the shim
          </span>
        ) : (
          <span className="muted small">Not read yet: ask the engine for it (the driver must be stopped; the shim must be able to connect).</span>
        )}
        <span className="spacer" />
        {envs && envs.length > 0 ? <EnvPicker envs={envs} env={env} setEnv={setEnv} testid="app-schema-env" /> : <span className="muted small">no environment</span>}
        <button disabled={!env || busy} onClick={refresh} title="DriverGetSchema: the engine asks the shim and the tree keeps the answer" data-testid="app-schema-refresh">
          {busy ? "Asking the shim…" : "Refresh application schema"}
        </button>
        <input className="outline-filter" style={{ width: 200 }} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter…" spellCheck={false} />
      </div>
      {result && (
        <div className={result.ok ? "banner" : "banner error"} data-testid="app-schema-result">
          {result.refusal ?? (result.text || "").trim()}
        </div>
      )}
      {schema?.present &&
        schema.classes
          .filter((c) => !q || c.name.toLowerCase().includes(q) || c.attributes.some((a) => a.name.toLowerCase().includes(q)))
          .map((c) => (
            <details key={c.name} className="fgroup" open={!!q}>
              <summary>
                <span className="module">
                  {c.name}
                  {c.container ? " (container)" : ""}
                </span>
                <span className="muted small">{c.attributes.length} attributes</span>
              </summary>
              <div className="chips pad-x">
                {c.attributes
                  .filter((a) => !q || a.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
                  .map((a) => (
                    <span key={a.name} className={"chip" + (a.required ? " mandatory" : "")} title={`${a.type || "string"}${a.multi ? " · multi-valued" : ""}${a.required ? " · required" : ""}${a.naming ? " · naming" : ""}`}>
                      {a.name}
                    </span>
                  ))}
              </div>
            </details>
          ))}
      {schema?.present && schema.classes.length === 0 && <p className="muted">The shim reported an empty schema.</p>}
      <p className="muted small">The application schema is a reference for the schema map, the filter and the policies — it is never deployed.</p>
    </div>
  );
}
