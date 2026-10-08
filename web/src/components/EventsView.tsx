import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { CasePlan, EventDetail, EventRow, EventsDescribe, Outline, Selection } from "../types";

interface Props {
  env: string;
  outline: Outline | null;
  /** the tree's driver names, for the case's driver pick */
  drivers: string[];
  onSelect: (s: Selection) => void;
  onOpen: (path: string) => void;
  onSaved: () => void;
}

const TYPES = ["add", "modify", "delete", "sync", "rename", "move"];
const SINCE: { value: string; label: string }[] = [
  { value: "1h", label: "last hour" },
  { value: "24h", label: "last day" },
  { value: "7d", label: "last week" },
  { value: "30d", label: "last 30 days" },
  { value: "", label: "any time" },
];

export interface EventFilters {
  where: "" | "dn" | "under" | "name";
  dn: string;
  driver: string;
  policy: string;
  stage: string;
  rows: "" | "own" | "logged";
  types: string[];
  className: string;
  since: string;
  text: string;
  attr: string;
  limit: number;
}

export const EMPTY: EventFilters = { where: "", dn: "", driver: "", policy: "", stage: "", rows: "", types: [], className: "", since: "24h", text: "", attr: "", limit: 200 };

/** The query string `/api/events` takes, from the form; empty fields are left out. */
export function queryOf(f: EventFilters): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.where && f.dn.trim()) {
    q[f.where] = f.dn.trim();
  }
  if (f.driver) {
    q.driver = f.driver;
  }
  if (f.policy.trim()) {
    q.policy = f.policy.trim();
  }
  if (f.stage) {
    q.stage = f.stage;
  }
  if (f.rows) {
    q.rows = f.rows;
  }
  if (f.types.length > 0 && f.types.length < TYPES.length) {
    q.type = f.types.join(",");
  }
  if (f.className.trim()) {
    q.class = f.className.trim();
  }
  if (f.since) {
    q.since = f.since;
  }
  if (f.text.trim()) {
    q.text = f.text.trim();
  }
  if (f.attr.trim()) {
    q.attr = f.attr.trim();
  }
  q.limit = String(f.limit);
  return q;
}

/**
 * The Event Logger's store for one environment: what it holds, the rows the filters choose, one
 * row with its modify diff and the other rows of the same engine event, and a row saved as a
 * simulator case — planned first, the files shown, then written into the tree's cases/.
 */
export function EventsView({ env, outline, drivers, onSelect, onOpen, onSaved }: Props) {
  const [info, setInfo] = useState<EventsDescribe | null>(null);
  const [f, setF] = useState<EventFilters>(EMPTY);
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<EventDetail | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [showXml, setShowXml] = useState(false);

  useEffect(() => {
    setInfo(null);
    api.events
      .describe(env)
      .then(setInfo)
      .catch((e: Error) => setInfo({ environment: env, configured: false, ok: false, message: e.message }));
  }, [env]);

  const search = (filters: EventFilters = f) => {
    setBusy(true);
    setError(null);
    api.events
      .list(env, queryOf(filters))
      .then((r) => setRows(r.events))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const timeline = (dn: string) => {
    const next = { ...f, where: "dn" as const, dn, since: "", types: [] };
    setF(next);
    search(next);
  };
  const open = (id: number) => {
    api.events
      .get(env, id)
      .then((d) => {
        setPicked(d);
        setShowJson(false);
        setShowXml(false);
      })
      .catch((e: Error) => setError(e.message));
  };

  // links into the tree: the driver by its name, a policy by its name among that driver's policies
  const driverInTree = (name: string | null) => (name && drivers.includes(name) ? name : null);
  const policyPath = (driver: string | null, policy: string | null): string | null => {
    if (!outline || !driver || !policy) {
      return null;
    }
    const d = outline.drivers.find((x) => x.name === driver);
    if (!d) {
      return null;
    }
    const leaf = policy.includes("\\") ? policy.slice(policy.lastIndexOf("\\") + 1) : policy;
    const all = [...d.policies.driver, ...d.policies.subscriber, ...d.policies.publisher];
    return all.find((p) => p.name === leaf || p.path.endsWith("/" + leaf))?.path ?? null;
  };

  const stats = useMemo(() => {
    const by = (key: (r: EventRow) => string) => {
      const m = new Map<string, number>();
      (rows ?? []).forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1));
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return { type: by((r) => r.type), cls: by((r) => r.class), driver: by((r) => r.driver ?? "?") };
  }, [rows]);

  if (!info) {
    return <p className="muted pad">Reading the store…</p>;
  }
  if (!info.configured) {
    return (
      <div className="pad">
        <div className="banner">{info.message}</div>
        <p className="muted small">
          An environment names its Event Logger store with <code>eventsUrl</code>, <code>eventsUser</code> and <code>eventsPassword</code> (or <code>…Keychain</code>, <code>…Command</code>, <code>…Env</code>) in the environments file; <code>eventsPseudonymise=true</code> masks people in what the page shows. See the core's docs/event-store.md.
        </p>
      </div>
    );
  }
  return (
    <div className="pad events" data-testid="events">
      <div className="addrow">
        {info.ok ? (
          <span className="small">
            <strong>{info.rows}</strong> rows{info.newest ? `, newest ${String(info.newest).replace("T", " ").slice(0, 16)}` : ""}
            {info.migrated === false && <span className="pill warn"> table not migrated to 2.0.0</span>}
            {info.pseudonymise && <span className="pill"> pseudonymised</span>}
            <span className="muted"> · {info.url}</span>
          </span>
        ) : (
          <span className="err-text small">{info.message}</span>
        )}
      </div>
      <div className="addrow evfilters" data-testid="events-filters">
        <select value={f.where} onChange={(e) => setF({ ...f, where: e.target.value as EventFilters["where"] })} title="How the DN field is used">
          <option value="">any object</option>
          <option value="dn">object (timeline)</option>
          <option value="under">under container</option>
          <option value="name">name ends with</option>
        </select>
        <input value={f.dn} onChange={(e) => setF({ ...f, dn: e.target.value })} placeholder="\TREE\data\users\jdoe or cn=jdoe,ou=users,o=data" spellCheck={false} style={{ width: 300 }} disabled={!f.where} data-testid="events-dn" />
        <select value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })} data-testid="events-driver">
          <option value="">any driver</option>
          {(info.drivers ?? []).map((d) => (
            <option key={d.dn} value={d.name ?? d.dn}>
              {d.name}
            </option>
          ))}
        </select>
        <select value={f.rows} onChange={(e) => setF({ ...f, rows: e.target.value as EventFilters["rows"] })} title="The EventLogger driver's own rows, or what policies logged through PolicyLogger">
          <option value="">own and logged</option>
          <option value="own">driver's own rows</option>
          <option value="logged">logged by policies</option>
        </select>
        <input value={f.policy} onChange={(e) => setF({ ...f, policy: e.target.value })} placeholder="policy" spellCheck={false} style={{ width: 160 }} />
        <select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
          <option value="">input or output</option>
          <option value="input">input</option>
          <option value="output">output</option>
        </select>
      </div>
      <div className="addrow evfilters">
        {TYPES.map((t) => (
          <label key={t} className={"checkchip" + (f.types.length === 0 || f.types.includes(t) ? " on" : "")}>
            <input type="checkbox" checked={f.types.length === 0 || f.types.includes(t)} onChange={() => setF({ ...f, types: f.types.length === 0 ? TYPES.filter((x) => x !== t) : f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] })} /> {t}
          </label>
        ))}
        <input value={f.className} onChange={(e) => setF({ ...f, className: e.target.value })} placeholder="class" spellCheck={false} style={{ width: 110 }} />
        <select value={f.since} onChange={(e) => setF({ ...f, since: e.target.value })} data-testid="events-since">
          {SINCE.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="text in the event" spellCheck={false} style={{ width: 160 }} title="Scans the JSON; needs a time window or another indexed selector on a large store" />
        <input value={f.attr} onChange={(e) => setF({ ...f, attr: e.target.value })} placeholder="modified attribute" spellCheck={false} style={{ width: 150 }} />
        <input type="number" min={1} max={1000} value={f.limit} onChange={(e) => setF({ ...f, limit: Math.max(1, Math.min(1000, Number(e.target.value) || 200)) })} style={{ width: 70 }} title="at most 1000" />
        <button className="primary" onClick={() => search()} disabled={busy || !info.ok} data-testid="events-search">
          {busy ? "Reading…" : "Search"}
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="evbody">
        <div className="evlist">
          {rows && rows.length > 0 && (
            <div className="small muted evstats" data-testid="events-stats">
              {rows.length} rows{rows.length >= f.limit ? " (limit reached)" : ""} ·{" "}
              {stats.type.map(([k, n]) => `${k} ${n}`).join(", ")} · classes {stats.cls.map(([k, n]) => `${k} ${n}`).join(", ")}
              {stats.driver.length > 1 ? ` · drivers ${stats.driver.map(([k, n]) => `${k} ${n}`).join(", ")}` : ""}
            </div>
          )}
          {rows && rows.length === 0 && <p className="muted">No rows match.</p>}
          {rows && rows.length > 0 && (
            <table className="grid" data-testid="events-rows">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Class</th>
                  <th>Object</th>
                  <th>Driver</th>
                  <th>Policy</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={"clickable" + (picked?.id === r.id ? " selected" : "")} onClick={() => open(r.id)}>
                    <td className="small nowrap">{(r.time ?? "").replace("T", " ").slice(0, 19)}</td>
                    <td>
                      <span className={"pill ev-" + r.type}>{r.type}</span>
                    </td>
                    <td className="small">{r.class}</td>
                    <td className="small" title={r.srcDn ?? ""}>
                      {r.srcDn && (
                        <button
                          className="link"
                          title="This object's timeline"
                          onClick={(e) => {
                            e.stopPropagation();
                            timeline(r.srcDn!);
                          }}
                        >
                          {r.srcDn.slice(r.srcDn.lastIndexOf("\\") + 1)}
                        </button>
                      )}
                      <span className="muted"> {r.srcDn?.slice(0, r.srcDn.lastIndexOf("\\"))}</span>
                    </td>
                    <td className="small">
                      {driverInTree(r.driver) ? (
                        <button
                          className="link"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect({ type: "config", driver: r.driver! });
                          }}
                        >
                          {r.driver}
                        </button>
                      ) : (
                        r.driver
                      )}
                    </td>
                    <td className="small">
                      {r.policy &&
                        (policyPath(r.driver, r.policy) ? (
                          <button
                            className="link"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpen(policyPath(r.driver, r.policy)!);
                            }}
                          >
                            {r.policy}
                          </button>
                        ) : (
                          r.policy
                        ))}
                      {r.stage && <span className="muted"> {r.stage}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!rows && <p className="muted">Choose filters and search. Nothing is read until you do.</p>}
        </div>
        {picked && (
          <EventPanel
            env={env}
            event={picked}
            drivers={drivers}
            showJson={showJson}
            showXml={showXml}
            onToggleJson={() => setShowJson(!showJson)}
            onToggleXml={() => setShowXml(!showXml)}
            onClose={() => setPicked(null)}
            onOpenRow={open}
            onSaved={onSaved}
            onSimulator={() => onSelect({ type: "simulator" })}
          />
        )}
      </div>
    </div>
  );
}

function EventPanel({ env, event: e, drivers, showJson, showXml, onToggleJson, onToggleXml, onClose, onOpenRow, onSaved, onSimulator }: { env: string; event: EventDetail; drivers: string[]; showJson: boolean; showXml: boolean; onToggleJson: () => void; onToggleXml: () => void; onClose: () => void; onOpenRow: (id: number) => void; onSaved: () => void; onSimulator: () => void }) {
  const [saving, setSaving] = useState(false);
  const [plan, setPlan] = useState<CasePlan | null>(null);
  const [name, setName] = useState("");
  const [driver, setDriver] = useState(e.driver && drivers.includes(e.driver) ? e.driver : (drivers[0] ?? ""));
  const [channel, setChannel] = useState(e.channel ?? "subscriber");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPlan(null);
    setSaving(false);
    setName("");
    setDriver(e.driver && drivers.includes(e.driver) ? e.driver : (drivers[0] ?? ""));
    setChannel(e.channel ?? "subscriber");
  }, [e.id, e.driver, e.channel, drivers]);
  const planIt = () => {
    setBusy(true);
    api.events
      .saveCase(env, { id: e.id, name: name || undefined, driver, channel, replace, dryRun: true })
      .then((p) => {
        setPlan(p);
        if (!name) {
          setName(p.name);
        }
      })
      .catch((err: Error) => setPlan({ ok: false, refusal: err.message, dir: null, files: {}, reconstructed: false, replaced: false, name: name, written: false }))
      .finally(() => setBusy(false));
  };
  const write = () => {
    setBusy(true);
    api.events
      .saveCase(env, { id: e.id, name, driver, channel, replace, dryRun: false })
      .then((p) => {
        setPlan(p);
        if (p.written) {
          // the tree changed: the page reloads its outline, which remounts this view — so go
          // straight to the simulator, where the new case is listed and can be run and recorded
          onSaved();
          onSimulator();
        }
      })
      .catch((err: Error) => setPlan({ ok: false, refusal: err.message, dir: null, files: {}, reconstructed: false, replaced: false, name, written: false }))
      .finally(() => setBusy(false));
  };
  return (
    <aside className="setpanel evpanel" data-testid="event-panel">
      <div className="setpanel-head">
        <div>
          <div className="kicker">
            {e.type} · {e.class} · row {e.id}
          </div>
          <h3 title={e.srcDn ?? ""}>{e.srcDn ? e.srcDn.slice(e.srcDn.lastIndexOf("\\") + 1) : e.eventId}</h3>
          <div className="muted small">
            {(e.time ?? "").replace("T", " ").slice(0, 19)} · {e.driver}
            {e.policy ? ` · ${e.policy} (${e.channel}, ${e.stage})` : ""} · schema {e.schemaVersion}
            {!e.hasXml && !e.xml ? " · no XML stored" : ""}
          </div>
        </div>
        <button className="linkish" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      {e.changes && e.changes.length > 0 && (
        <table className="grid" data-testid="event-changes">
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Removed</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {e.changes.map((c) => (
              <tr key={c.attribute}>
                <td>{c.attribute}</td>
                <td className="small">{c.removeAll ? <em>all values</em> : c.removed.join(", ")}</td>
                <td className="small">{c.added.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {e.sameEvent.length > 0 && (
        <div className="small">
          <strong>Same engine event:</strong>{" "}
          {e.sameEvent.map((s) => (
            <button key={s.id} className="link" onClick={() => onOpenRow(s.id)}>
              {s.policy ? `${s.policy}/${s.stage}` : "driver row"}
            </button>
          ))}
        </div>
      )}
      <div className="addrow">
        <button className="mini" onClick={onToggleJson}>
          {showJson ? "hide JSON" : "JSON"}
        </button>
        {e.xml && (
          <button className="mini" onClick={onToggleXml}>
            {showXml ? "hide XML" : "XML"}
          </button>
        )}
        <span className="spacer" />
        <button className="primary" onClick={() => setSaving(!saving)} data-testid="event-save-case">
          Save as case…
        </button>
      </div>
      {showJson && <pre className="evdoc">{JSON.stringify(e.json, null, 2)}</pre>}
      {showXml && e.xml && <pre className="evdoc">{e.xml}</pre>}
      {saving && (
        <div className="evcase" data-testid="event-case">
          <label className="field wide">
            <em>Case name</em>
            <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="default: driver-type-date" spellCheck={false} />
          </label>
          <label className="field">
            <em>Driver</em>
            <select value={driver} onChange={(ev) => setDriver(ev.target.value)}>
              {drivers.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <em>Channel</em>
            <select value={channel} onChange={(ev) => setChannel(ev.target.value)}>
              <option value="subscriber">subscriber</option>
              <option value="publisher">publisher</option>
            </select>
          </label>
          <label className="checkchip">
            <input type="checkbox" checked={replace} onChange={(ev) => setReplace(ev.target.checked)} /> replace an existing case
          </label>
          <div className="addrow">
            <button onClick={planIt} disabled={busy || !driver}>
              {busy ? "…" : "Show the files"}
            </button>
            <button className="primary" onClick={write} disabled={busy || !driver || !plan || !plan.ok || plan.written} data-testid="event-write-case" title="Write the case into the tree's cases/ and open the simulator, where it is listed">
              Write and open the simulator
            </button>
          </div>
          {plan && !plan.ok && <div className="banner error">{plan.refusal}</div>}
          {plan && plan.ok && (
            <div className="small" data-testid="event-case-plan">
              {plan.written ? "Wrote " : "Would write "}
              <code>{plan.dir}</code>
              {plan.replaced ? " (replacing it)" : ""}
              {plan.reconstructed ? " — input.xds rebuilt from the JSON (lossy)" : ""}
              {Object.entries(plan.files).map(([file, content]) => (
                <details key={file}>
                  <summary>{file}</summary>
                  <pre className="evdoc">{content}</pre>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
