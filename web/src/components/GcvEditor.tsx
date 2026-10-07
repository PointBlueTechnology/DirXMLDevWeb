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

/** The GCVs a driver sees, in the order the engine resolves them: its own, then what it links, then the driver set's. */
const SCOPE_ORDER = ["driver", "driver-link", "driverset-link", "driverset"];
const SCOPE_GROUPS: Record<string, { key: string; title: string; note?: string }> = {
  driver: { key: "driver", title: "This driver's own GCVs" },
  "driver-link": { key: "driver-link", title: "From GCV resources this driver links", note: "a package's resource; changing a value changes it for every driver that links the same resource" },
  "driverset-link": { key: "driverset-link", title: "Inherited from the driver set (Library GCV resources)", note: "shared by every driver in the set — a change here is a change for all of them" },
  driverset: { key: "driverset", title: "Inherited from the driver set's own GCVs", note: "shared by every driver in the set" },
};

/**
 * The GCVs in a driver's scope (or the driver set's): each from the place the engine would take
 * it, editable there through `gcv.set`. A value that differs per environment is set in the environment
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
        rows={[...config.gcvs].sort((a, b) => SCOPE_ORDER.indexOf(a.scope ?? "driver") - SCOPE_ORDER.indexOf(b.scope ?? "driver"))}
        group={driver ? (row) => SCOPE_GROUPS[row.scope ?? "driver"] ?? null : undefined}
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
        meta={(row) => (
          <div className="metaline">
            <span className="metaitem">
              <span className="k">Defined in</span>
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
            </span>
            <span className="metaitem usedby" data-testid={"gcv-usedby-" + row.name}>
              <span className="k">Used by</span>
              {!row.usedBy || row.usedBy.length === 0 ? (
                <span className="muted" title="No policy or configuration document in this scope reads it">
                  —
                </span>
              ) : (
                row.usedBy.map((u) => (
                  <button key={u.path} className="link" title={u.kind === "policy" ? u.path : `${u.kind} of ${u.path.split("/")[1]} (~${row.name}~)`} onClick={() => onOpen(u.file ?? u.path)}>
                    {u.kind === "policy" ? u.path.split("/").pop() : u.kind}
                  </button>
                ))
              )}
            </span>
            {canOverride &&
              envs.map((e) => (
                <span key={e} className="metaitem env" title={`overrides/${e}.properties`}>
                  <span className="k">{e}</span>
                  <input value={overrideValue(row, e)} placeholder="base" disabled={!row.editable} onChange={(ev) => setOverride(row, e, ev.target.value)} spellCheck={false} />
                </span>
              ))}
          </div>
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
          <span className="muted small">A value typed in an environment's column is that environment's override; the Value column is the base every other stage gets.</span>
        </div>
      ) : (
        <p className="muted small">Env overrides need a DirXMLDev with the override operations (DirXMLDev 0.8.0).</p>
      )}
    </div>
  );
}
