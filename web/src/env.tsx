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

/** The environment as a select when there is a choice, as a name otherwise. */
export function EnvPicker({ envs, env, setEnv, testid }: { envs: VaultEnvironment[]; env: string; setEnv: (name: string) => void; testid?: string }) {
  const chosen = envs.find((e) => e.name === env);
  if (envs.length <= 1) {
    return (
      <span className="envname" data-testid={testid}>
        <strong>{chosen?.name ?? env}</strong>
        {chosen && <span className={"pill tier-" + chosen.tier}> {chosen.tier}</span>}
      </span>
    );
  }
  return (
    <select value={env} onChange={(e) => setEnv(e.target.value)} data-testid={testid}>
      {!chosen && <option value="">choose…</option>}
      {envs.map((e) => (
        <option key={e.name} value={e.name} disabled={!e.ready}>
          {e.name} ({e.tier}){e.ready ? "" : " — not configured"}
        </option>
      ))}
    </select>
  );
}
