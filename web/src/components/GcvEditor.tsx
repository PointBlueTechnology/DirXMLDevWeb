import { useState } from "react";
import type { Pending } from "../pending";
import type { ConfigView, Definition, OverridesData } from "../types";
import { DefinitionsTable } from "./DefinitionsTable";

interface Props {
  config: ConfigView;
  overrides: OverridesData | null;
  canOverride: boolean;
  pending: Pending;
  onOpen: (path: string) => void;
}

const TYPES = ["string", "boolean", "integer", "dn", "enum"];

/**
 * The GCVs in a driver's scope (or the driver set's): each from the place the engine would take
 * it, editable there through `gcv.set`. A value that differs per stage is set in the environment
 * columns, which write `overrides/<env>.properties` and leave the base alone.
 */
export function GcvEditor({ config, overrides, canOverride, pending, onOpen }: Props) {
  const driver = config.driver;
  const [extraEnvs, setExtraEnvs] = useState<string[]>([]);
  const [newEnv, setNewEnv] = useState("");
  const [draft, setDraft] = useState({ name: "", type: "string", display: "", value: "" });
  const envs = [...new Set([...(overrides?.environments ?? []), ...extraEnvs])];
  const scope = driver ? `drivers/${driver}` : "driverset";

  const stagedValue = (name: string) => pending.ops.find((o) => o.key === `gcv:${name}`)?.args.value;

  const setValue = (row: Definition, value: string) => {
    if (value === row.value) {
      pending.put(`gcv:${row.name}`, null);
      return;
    }
    const args: Record<string, string> = { name: row.name, value };
    if (driver) {
      args.driver = driver;
    }
    pending.put(`gcv:${row.name}`, { name: "gcv.set", args, label: `${row.name} = ${value}` });
  };

  const overrideValue = (row: Definition, env: string): string => {
    const staged = pending.ops.find((o) => o.key === `ovr:${env}:${row.overrideKey}`);
    if (staged) {
      return staged.name === "override.remove" ? "" : (staged.args.value ?? "");
    }
    return overrides?.overrides.find((o) => o.key === row.overrideKey)?.values[env] ?? "";
  };

  const setOverride = (row: Definition, env: string, value: string) => {
    const key = row.overrideKey;
    if (!key) {
      return;
    }
    const stored = overrides?.overrides.find((o) => o.key === key)?.values[env];
    const pkey = `ovr:${env}:${key}`;
    if (value === (stored ?? "")) {
      pending.put(pkey, null);
    } else if (value === "") {
      pending.put(pkey, { name: "override.remove", args: { env, key }, label: `${env}: ${row.name} back to the base value` });
    } else {
      pending.put(pkey, { name: "override.set", args: { env, key, value }, label: `${env}: ${row.name} = ${value}` });
    }
  };

  const add = () => {
    const name = draft.name.trim();
    if (!name) {
      return;
    }
    const args: Record<string, string> = { name, value: draft.value, define: draft.type };
    if (draft.display.trim()) {
      args["display-name"] = draft.display.trim();
    }
    if (driver) {
      args.driver = driver;
    }
    pending.put(`gcv:${name}`, { name: "gcv.set", args, label: `new GCV ${name} (${draft.type}) = ${draft.value}` });
    setDraft({ name: "", type: "string", display: "", value: "" });
  };

  return (
    <div className="pad">
      <DefinitionsTable
        rows={config.gcvs}
        empty="No GCVs are defined in this scope."
        staged={stagedValue}
        onChange={setValue}
        onDelete={(row) => {
          const args: Record<string, string> = { name: row.name };
          if (driver) {
            args.driver = driver;
          }
          pending.put(`gcvdel:${row.name}`, { name: "gcv.delete", args, label: `delete GCV ${row.name}` });
        }}
        extraHead={
          <>
            <th>Defined in</th>
            {canOverride &&
              envs.map((e) => (
                <th key={e} title={`overrides/${e}.properties`}>
                  {e}
                </th>
              ))}
          </>
        }
        extra={(row) => (
          <>
            <td className="small">
              {row.owner === scope ? (
                <span className="muted">here</span>
              ) : row.owner === "driverset" ? (
                <span className="warn-text" title="Shared: changing it changes every driver that reads it">
                  driver set
                </span>
              ) : (
                <button className="link" title="Shared: a GCV resource. Changing it changes every driver that links it" onClick={() => row.owner && onOpen(row.owner)}>
                  {row.owner}
                </button>
              )}
            </td>
            {canOverride &&
              envs.map((e) => (
                <td key={e} className="vcell">
                  <input value={overrideValue(row, e)} placeholder="base" disabled={!row.editable} onChange={(ev) => setOverride(row, e, ev.target.value)} spellCheck={false} />
                </td>
              ))}
          </>
        )}
      />
      <div className="addrow">
        <strong className="small">New GCV</strong>
        <input placeholder="name (e.g. drv.users)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
          {TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input placeholder="display name" value={draft.display} onChange={(e) => setDraft({ ...draft, display: e.target.value })} />
        <input placeholder="value" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
        <button onClick={add} disabled={!draft.name.trim()}>
          Add
        </button>
      </div>
      {canOverride ? (
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
          <span className="muted small">A value typed in an environment's column is that stage's override; the Value column is the base every other stage gets.</span>
        </div>
      ) : (
        <p className="muted small">Per-stage overrides need a DirXMLDev with the override operations (after 0.7.0).</p>
      )}
    </div>
  );
}
