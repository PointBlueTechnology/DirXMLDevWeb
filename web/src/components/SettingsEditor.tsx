import type { Pending } from "../pending";
import type { ConfigView, Definition } from "../types";
import { DefinitionsTable } from "./DefinitionsTable";

/** A driver's own settings: the shim class and authentication, its shim parameters and its engine control values (`driver.set`). */
export function SettingsEditor({ config, pending }: { config: ConfigView; pending: Pending }) {
  const driver = config.driver ?? "";
  const set = (key: string, label: string, original: string, value: string) => {
    if (value === original || value === "") {
      pending.put(`set:${key}`, null);   // the core requires a value; clearing a setting is done in the XML
      return;
    }
    pending.put(`set:${key}`, { name: "driver.set", args: { driver, key, value }, label: `${label} = ${value}` });
  };
  const staged = (key: string) => pending.ops.find((o) => o.key === `set:${key}`)?.args.value;
  const field = (key: string, label: string, original: string | null | undefined) => (
    <label className="field">
      <span>{label}</span>
      <input value={staged(key) ?? original ?? ""} onChange={(e) => set(key, label, original ?? "", e.target.value)} spellCheck={false} className={staged(key) !== undefined ? "changed" : ""} />
    </label>
  );
  const table = (rows: Definition[] | undefined, prefix: string, empty: string) => (
    <DefinitionsTable rows={rows ?? []} empty={empty} staged={(name) => staged(`${prefix}:${name}`)} onChange={(row, v) => set(`${prefix}:${row.name}`, row.name, row.value, v)} />
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
      <h3>Engine control values</h3>
      {table(config.ecvs, "engine", "No engine control values in the tree. The engine writes its defaults when the driver first starts; import-live adopts them.")}
    </div>
  );
}
