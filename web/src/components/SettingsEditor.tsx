import { useState } from "react";
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
