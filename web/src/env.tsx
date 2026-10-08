import { useEffect, useState } from "react";
import { api } from "./api";
import type { VaultEnvironment } from "./types";

const KEY = "idmweb.env";

/**
 * The environment the page works against: one choice for every view (Vault, Schema, App schema,
 * Events, Trace), remembered in this browser, taken from the environments the server lists for
 * this project — a project's own environments when the hosted configuration names them, else the
 * environments file's. With one environment there is nothing to choose.
 */
export function useEnvironment(): { envs: VaultEnvironment[] | null; env: string; setEnv: (name: string) => void; why: string | null } {
  const [envs, setEnvs] = useState<VaultEnvironment[] | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [env, setEnvState] = useState<string>(() => {
    try {
      return localStorage.getItem(KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    api.vault
      .environments()
      .then((v) => {
        setEnvs(v.environments);
        setWhy(v.available ? null : (v.why ?? null));
        setEnvState((cur) => (v.environments.some((e) => e.name === cur) ? cur : (v.environments.find((e) => e.ready)?.name ?? v.environments[0]?.name ?? "")));
      })
      .catch((e: Error) => {
        setEnvs([]);
        setWhy(e.message);
      });
  }, []);
  const setEnv = (name: string) => {
    setEnvState(name);
    try {
      localStorage.setItem(KEY, name);
    } catch {
      // per-browser convenience only
    }
  };
  return { envs, env, setEnv, why };
}

/** Why an environment is not ready: the person has not connected to one the project defines, or it is incomplete. */
function notReady(e: VaultEnvironment): string {
  return e.defined && !e.connected ? "set up your connection" : "not configured";
}

/**
 * The environment as a select when there is a choice, as a name otherwise. One the person has
 * not connected to says so, with the way to Connections.
 */
export function EnvPicker({ envs, env, setEnv, testid }: { envs: VaultEnvironment[]; env: string; setEnv: (name: string) => void; testid?: string }) {
  const chosen = envs.find((e) => e.name === env);
  const hint =
    chosen && !chosen.ready ? (
      <a className="pill warn" href={"#type=connections&env=" + encodeURIComponent(chosen.name)} title="Open Connections for this environment">
        {notReady(chosen)}
      </a>
    ) : null;
  if (envs.length <= 1) {
    return (
      <span className="envname" data-testid={testid}>
        <strong>{chosen?.name ?? env}</strong>
        {chosen && <span className={"pill tier-" + chosen.tier}> {chosen.tier}</span>}
        {hint}
      </span>
    );
  }
  return (
    <span className="envname">
      <select value={env} onChange={(e) => setEnv(e.target.value)} data-testid={testid}>
        {!chosen && <option value="">choose…</option>}
        {envs.map((e) => (
          <option key={e.name} value={e.name}>
            {e.name} ({e.tier}){e.ready ? "" : " — " + notReady(e)}
          </option>
        ))}
      </select>
      {hint}
    </span>
  );
}
