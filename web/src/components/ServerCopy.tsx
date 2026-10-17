import { useState } from "react";
import type { OpCall } from "../types";
import { ReviewDialog } from "./ReviewDialog";

const KINDS: { key: string; label: string }[] = [
  { key: "gcv", label: "GCV values" },
  { key: "shim", label: "shim parameters" },
  { key: "ecv", label: "engine control values" },
  { key: "auth-server", label: "the shim's server" },
  { key: "auth-id", label: "the shim's account" },
];

/**
 * Copy a driver's server-specific settings from one server of the set to another (#134,
 * `driver.server.copy`): the never-sync values each server holds for itself. Reviewed like any edit;
 * a deploy then writes them to the target server.
 */
export function ServerCopy({ servers, drivers, onSaved }: { servers: { dn: string; name: string; primary: boolean }[]; drivers: string[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(servers.find((s) => s.primary)?.dn ?? servers[0]?.dn ?? "");
  const [to, setTo] = useState(servers.find((s) => !s.primary)?.dn ?? "");
  const [driver, setDriver] = useState("");
  const [kinds, setKinds] = useState<string[]>(KINDS.map((k) => k.key));
  const [ops, setOps] = useState<OpCall[] | null>(null);
  if (!open) {
    return (
      <button className="link" onClick={() => setOpen(true)} data-testid="server-copy-open">
        Copy server-specific settings from one server to another…
      </button>
    );
  }
  const label = (dn: string) => servers.find((s) => s.dn === dn)?.name ?? dn;
  const review = () => {
    const args: Record<string, string> = { from, to };
    if (driver) {
      args.driver = driver;
    }
    if (kinds.length < KINDS.length) {
      args.only = kinds.join(",");
    }
    setOps([{ name: "driver.server.copy", args, label: `${driver || "every driver"}: ${label(from)} → ${label(to)}` }]);
  };
  return (
    <div className="block" data-testid="server-copy">
      <p className="muted small">
        Each server holds its own copy of these settings for every driver. The copy makes the target hold what the source holds; the
        other servers stay as they are. A deploy then writes them to the target server.
      </p>
      <div className="attrs">
        <label className="field">
          <em>From</em>
          <select value={from} onChange={(e) => setFrom(e.target.value)} data-testid="server-copy-from">
            {servers.map((s) => (
              <option key={s.dn} value={s.dn}>
                {s.name}
                {s.primary ? " (primary)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <em>To</em>
          <select value={to} onChange={(e) => setTo(e.target.value)} data-testid="server-copy-to">
            {servers.map((s) => (
              <option key={s.dn} value={s.dn}>
                {s.name}
                {s.primary ? " (primary)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <em>Driver</em>
          <select value={driver} onChange={(e) => setDriver(e.target.value)} data-testid="server-copy-driver">
            <option value="">every driver</option>
            {drivers.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="attrs">
        {KINDS.map((k) => (
          <label key={k.key} className="checkchip">
            <input type="checkbox" checked={kinds.includes(k.key)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k.key] : kinds.filter((x) => x !== k.key))} /> {k.label}
          </label>
        ))}
      </div>
      <div className="addrow">
        <button onClick={() => setOpen(false)}>Cancel</button>
        <button className="primary" onClick={review} disabled={!from || !to || from === to || kinds.length === 0} data-testid="server-copy-review">
          Review the copy…
        </button>
        {from === to && <span className="muted small">pick two different servers</span>}
      </div>
      {ops && (
        <ReviewDialog
          title={`Copy ${driver || "every driver"}'s server-specific settings: ${label(from)} → ${label(to)}`}
          ops={ops}
          onClose={() => setOps(null)}
          onApplied={() => {
            setOps(null);
            setOpen(false);
            onSaved();
          }}
        />
      )}
    </div>
  );
}
