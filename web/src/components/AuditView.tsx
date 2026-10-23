import { useEffect, useState } from "react";
import { api } from "../api";
import type { AuditEntry } from "../types";

/** The server's audit log (hosted mode, deployers): who did what, where, and how it went — newest first, filterable. */
export function AuditView() {
  const [f, setF] = useState({ user: "", project: "", event: "", since: "" });
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    api
      .audit({ ...f, limit: 300 })
      .then((r) => (setEntries(r.entries), setError(null)))
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, [f.user, f.project, f.event, f.since]);
  return (
    <div className="view audit">
      <div className="viewhead">
        <div>
          <div className="kicker">Hosted server</div>
          <h2>Audit log</h2>
        </div>
      </div>
      <div className="addrow pad-x" data-testid="audit-filter">
        <input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} placeholder="user" spellCheck={false} />
        <input value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} placeholder="project" spellCheck={false} />
        <input value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })} placeholder="event (sign-in, write, deploy, commit…)" spellCheck={false} />
        <input value={f.since} onChange={(e) => setF({ ...f, since: e.target.value })} placeholder="since, UTC (2026-10-07T00:00)" spellCheck={false} />
        <button onClick={load}>Refresh</button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {entries && (
        <div className="pad scroll">
          <table className="grid" data-testid="audit-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Project / branch</th>
                <th>Event</th>
                <th>Details</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.time + i} className={e.outcome && e.outcome !== "ok" ? "warn-row" : ""}>
                  <td className="small nowrap">{e.time.replace("T", " ").slice(0, 19)}</td>
                  <td className="small">{e.user ?? "—"}</td>
                  <td className="small">{e.project ? `${e.project}${e.branch ? " / " + e.branch : ""}` : "—"}</td>
                  <td>
                    <code>{e.event}</code>
                  </td>
                  <td className="small muted">{Object.entries(e.details ?? {}).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}</td>
                  <td className={"small " + (e.outcome === "ok" ? "ok-text" : "err-text")}>{e.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p className="muted">Nothing matches.</p>}
          <p className="muted small">One line per action, from <code>audit.log</code> in the data directory: names and flags only, never a file's contents or a secret.</p>
        </div>
      )}
    </div>
  );
}
