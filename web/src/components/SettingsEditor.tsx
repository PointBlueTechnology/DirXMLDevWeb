import { useEffect, useState } from "react";
import { api } from "../api";
import type { Pending } from "../pending";
import type { ConfigView, Definition } from "../types";
import { DefinitionsTable } from "./DefinitionsTable";

const TYPES = ["string", "integer", "boolean", "dn", "enum", "password-ref"];

/** A driver's own settings: the shim class and authentication, its shim parameters and its engine control values (`driver.set`). */
export function SettingsEditor({ config, pending }: { config: ConfigView; pending: Pending }) {
  const driver = config.driver ?? "";
  const set = (key: string, label: string, original: string, value: string) => {
    if (value === original) {
      pending.put(`set:${key}`, null);
      return;
    }
    // an engine control value has no meaningful "empty": the engine wants a typed value or its own
    // default — removing the row (×) is the way back to the default
    if (value === "" && key.startsWith("engine:")) {
      pending.put(`set:${key}`, null);
      return;
    }
    // an empty value clears the setting: the core's --clear flag (an empty --value reads as missing)
    pending.put(`set:${key}`, { name: "driver.set", args: value === "" ? { driver, key, clear: "true" } : { driver, key, value }, label: value === "" ? `${label} cleared` : `${label} = ${value}` });
  };
  const staged = (key: string) => pending.ops.find((o) => o.key === `set:${key}`)?.args.value;
  const field = (key: string, label: string, original: string | null | undefined) => (
    <label className="field">
      <span>{label}</span>
      <input value={staged(key) ?? original ?? ""} onChange={(e) => set(key, label, original ?? "", e.target.value)} spellCheck={false} className={staged(key) !== undefined ? "changed" : ""} />
    </label>
  );
  // a shim under development gets new parameters (and loses old ones) here, not in the XML (driver.setting.add / remove)
  const table = (rows: Definition[] | undefined, prefix: string, empty: string) => (
    <DefinitionsTable
      rows={rows ?? []}
      empty={empty}
      staged={(name) => staged(`${prefix}:${name}`)}
      onChange={(row, v) => set(`${prefix}:${row.name}`, row.name, row.value, v)}
      onDelete={(row) =>
        pending.put(`del:${prefix}:${row.name}`, {
          name: "driver.setting.remove",
          args: { driver, key: `${prefix}:${row.name}` },
          label: prefix === "param" ? `remove shim parameter ${row.name}` : `reset engine control value ${row.name} to the engine's default (removed from the tree)`,
        })
      }
    />
  );
  const [add, setAdd] = useState({ name: "", display: "", type: "string", value: "", section: "driver-options" });
  const adder = (prefix: "param" | "engine") => (
    <div className="addrow" data-testid={`setting-add-${prefix}`}>
      <input placeholder="name" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} spellCheck={false} />
      <input placeholder="display name" value={add.display} onChange={(e) => setAdd({ ...add, display: e.target.value })} />
      <select value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value })}>
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <input placeholder="value" value={add.value} onChange={(e) => setAdd({ ...add, value: e.target.value })} spellCheck={false} />
      {prefix === "param" && (
        <select value={add.section} onChange={(e) => setAdd({ ...add, section: e.target.value })}>
          <option value="driver-options">driver options</option>
          <option value="subscriber-options">subscriber options</option>
          <option value="publisher-options">publisher options</option>
        </select>
      )}
      <button
        disabled={!add.name.trim()}
        onClick={() => {
          const args: Record<string, string> = { driver, key: `${prefix}:${add.name.trim()}`, type: add.type, value: add.value };
          if (add.display.trim()) {
            args.display = add.display.trim();
          }
          if (prefix === "param") {
            args.section = add.section;
          }
          pending.add({ name: "driver.setting.add", args, label: `add ${prefix === "param" ? "shim parameter" : "engine control value"} ${add.name.trim()} = ${add.value}` });
          setAdd({ ...add, name: "", display: "", value: "" });
        }}
      >
        Add
      </button>
    </div>
  );
  return (
    <div className="pad">
      <DriverEnvironments config={config} pending={pending} />
      <h3>Shim</h3>
      {field("shim-class", "Shim class", config.shimClass)}
      {field("shim-auth-server", "Authentication server / connection", config.shimAuthServer)}
      {field("shim-auth-id", "Authentication id", config.shimAuthId)}
      <p className="muted small">The authentication password is a secret: it is set at deploy from the environment's secrets file, never stored in the tree.</p>
      <h3>Shim parameters</h3>
      {table(config.params, "param", "This driver's shim configuration defines no parameters.")}
      {adder("param")}
      <details className="ecvs" data-testid="ecvs">
        <summary>
          <h3>Engine control values {config.ecvs?.length ? <span className="count">{config.ecvs.length}</span> : null}</h3>
          <span className="muted small">the engine's own knobs, rarely changed — folded away until you need them. × puts one back to the engine's default: it leaves the tree, the deploy removes it from the vault, and the engine writes its default again at the driver's next start (import-live adopts it). An engine value cannot be empty.</span>
        </summary>
        {table(config.ecvs, "engine", "No engine control values in the tree. The engine writes its defaults when the driver first starts; import-live adopts them.")}
        {adder("engine")}
      </details>
    </div>
  );
}

/**
 * Which environments get this driver (`driver.set environments`; none ticked = every environment), and the name each
 * environment's vault gives it where that differs (`override.set drivers/<d>.name`). A driver not yet in production, or
 * one that never will be, names the others; one called differently in an environment needs no renaming there.
 */
function DriverEnvironments({ config, pending }: { config: ConfigView; pending: Pending }) {
  const driver = config.driver ?? "";
  const [known, setKnown] = useState<string[] | null>(null);
  useEffect(() => {
    api.vault
      .environments()
      .then((r) => setKnown(r.environments.map((e) => e.name)))
      .catch(() => setKnown([]));
  }, []);
  const original = config.environments ?? [];
  const staged = pending.ops.find((o) => o.key === "set:environments");
  const current: string[] = staged ? (staged.args.clear ? [] : String(staged.args.value ?? "").split(",").map((s) => s.trim()).filter(Boolean)) : original;
  const every = current.length === 0;
  const stage = (list: string[]) => {
    const same = list.length === original.length && list.every((e) => original.some((o) => o.toLowerCase() === e.toLowerCase()));
    if (same) {
      pending.put("set:environments", null);
      return;
    }
    pending.put(
      "set:environments",
      list.length === 0
        ? { name: "driver.set", args: { driver, key: "environments", clear: "true" }, label: `${driver}: deployed to every environment` }
        : { name: "driver.set", args: { driver, key: "environments", value: list.join(", ") }, label: `${driver}: deployed to ${list.join(", ")} only` }
    );
  };
  const plannedOriginal = config.planned ?? [];
  const plannedStaged = pending.ops.find((o) => o.key === "set:planned");
  const planned: string[] = plannedStaged ? (plannedStaged.args.clear ? [] : String(plannedStaged.args.value ?? "").split(",").map((x) => x.trim()).filter(Boolean)) : plannedOriginal;
  const stagePlanned = (list: string[]) => {
    const same = list.length === plannedOriginal.length && list.every((e) => plannedOriginal.some((o) => o.toLowerCase() === e.toLowerCase()));
    pending.put(
      "set:planned",
      same
        ? null
        : list.length === 0
          ? { name: "driver.set", args: { driver, key: "planned", clear: "true" }, label: `${driver}: nothing planned` }
          : { name: "driver.set", args: { driver, key: "planned", value: list.join(", ") }, label: `${driver}: planned for ${list.join(", ")}` }
    );
  };
  const names = config.environmentNames ?? {};
  const nameKey = (env: string) => `ovr:${env}:drivers/${driver}.name`;
  const stagedName = (env: string) => {
    const op = pending.ops.find((o) => o.key === nameKey(env));
    return op ? (op.name === "override.remove" ? "" : String(op.args.value ?? "")) : undefined;
  };
  const setName = (env: string, value: string) => {
    const was = names[env] ?? "";
    const v = value.trim();
    if (v === was) {
      pending.put(nameKey(env), null);
    } else if (v === "" || v === driver) {
      pending.put(nameKey(env), was ? { name: "override.remove", args: { env, key: `drivers/${driver}.name` }, label: `${env}: ${driver} under its own name` } : null);
    } else {
      pending.put(nameKey(env), { name: "override.set", args: { env, key: `drivers/${driver}.name`, value: v }, label: `${env}: ${driver} is called ${v} there` });
    }
  };
  const envs = [...new Set([...(known ?? []), ...current, ...Object.keys(names)])];
  const unknown = current.filter((e) => known !== null && !known.some((k) => k.toLowerCase() === e.toLowerCase()));
  return (
    <div data-testid="driver-environments">
      <h3>Environments</h3>
      <p className="muted small">
        Which environments get this driver. Compare and deploy to any other leave it out. Tick <em>Later</em> for one it is meant to reach once promoted (a driver not
        yet in production); leave it unticked for one that never gets it. The name is what that environment&apos;s vault calls it, when not <code>{driver}</code>.
      </p>
      <label className="check">
        <input type="checkbox" checked={every} onChange={(e) => stage(e.target.checked ? [] : (known ?? []).slice(0, 1))} data-testid="env-every" /> every environment
      </label>
      <table className="grid small">
        <thead>
          <tr>
            <th>Environment</th>
            <th>Gets it</th>
            <th title="Not yet: it is meant to reach this environment later">Later</th>
            <th>Name there</th>
          </tr>
        </thead>
        <tbody>
          {envs.map((env) => {
            const on = every || current.some((c) => c.toLowerCase() === env.toLowerCase());
            return (
              <tr key={env}>
                <td>{env}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={every}
                    onChange={(e) => stage(e.target.checked ? [...current, env] : current.filter((c) => c.toLowerCase() !== env.toLowerCase()))}
                    data-testid={"env-gets-" + env}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={!on && planned.some((x) => x.toLowerCase() === env.toLowerCase())}
                    disabled={on}
                    onChange={(e) => stagePlanned(e.target.checked ? [...planned, env] : planned.filter((x) => x.toLowerCase() !== env.toLowerCase()))}
                    title="Not yet: planned for this environment, waiting for promotion"
                    data-testid={"env-later-" + env}
                  />
                </td>
                <td>
                  <input
                    value={stagedName(env) ?? names[env] ?? ""}
                    placeholder={driver}
                    disabled={!on}
                    onChange={(e) => setName(env, e.target.value)}
                    spellCheck={false}
                    className={stagedName(env) !== undefined ? "changed" : ""}
                    data-testid={"env-name-" + env}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {unknown.length > 0 && <p className="warn-text small">Not an environment of this project: {unknown.join(", ")}.</p>}
    </div>
  );
}
