import { useState } from "react";
import { api } from "../api";
import { MANAGERS, managerById } from "../cred/managers";

/**
 * A credential read from a secret manager: pick the manager, fill its few fields, see the
 * command the core will run, test that it yields a value, and hand the command back.
 */
export function ManagerPicker({ helpers, onCommand }: { helpers: string; onCommand: (command: string) => void }) {
  const [id, setId] = useState(MANAGERS[0]!.id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const manager = managerById(id)!;
  const built = manager.command(values, helpers);
  const command = edited ?? built;
  const complete = manager.fields.every((f) => f.optional || (values[f.key] ?? "").trim() !== "");

  const update = (next: Record<string, string>) => {
    setValues(next);
    setEdited(null);
    setResult(null);
    onCommand(managerById(id)!.command(next, helpers));
  };
  const test = () => {
    setBusy(true);
    setResult(null);
    api.connections
      .resolve({ command })
      .then(setResult)
      .catch((e: Error) => setResult({ ok: false, message: e.message }))
      .finally(() => setBusy(false));
  };

  return (
    <div className="managerpicker" data-testid="manager-picker">
      <div className="addrow tight">
        <select
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setValues({});
            setEdited(null);
            setResult(null);
            onCommand("");
          }}
          data-testid="manager-id"
        >
          {MANAGERS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="muted small">needs {manager.needs}</span>
      </div>
      <div className="attrs">
        {manager.fields.map((f) => (
          <label key={f.key} className={"field" + (f.key === "command" ? " wide" : "")}>
            <em>
              {f.label}
              {f.optional ? " (optional)" : ""}
            </em>
            <input value={values[f.key] ?? ""} onChange={(e) => update({ ...values, [f.key]: e.target.value })} placeholder={f.placeholder} spellCheck={false} data-testid={"manager-" + f.key} />
          </label>
        ))}
      </div>
      <label className="field wide">
        <em>The command the core runs to read it (editable)</em>
        <input
          value={command}
          onChange={(e) => {
            setEdited(e.target.value);
            setResult(null);
            onCommand(e.target.value);
          }}
          spellCheck={false}
          className="mono"
          data-testid="manager-command"
        />
      </label>
      <div className="addrow tight">
        <button onClick={test} disabled={busy || !command || (!complete && edited === null)} data-testid="manager-test">
          {busy ? "Running…" : "Test: does it yield a value?"}
        </button>
        {result && (
          <span className={result.ok ? "ok-text" : "err-text"} data-testid="manager-result">
            {result.message}
          </span>
        )}
      </div>
      <p className="muted small">Only the command is saved; the value is read when needed, by the server's host, and never shown. The command runs with the environment of the shell that started the server.</p>
    </div>
  );
}
