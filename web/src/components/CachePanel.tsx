import { useEffect, useState } from "react";
import { api } from "../api";
import type { CacheView, CaseFiles } from "../types";

interface Props {
  env: string;
  driver: string;
  /** the environment's name typed: driver control and the cache clear need it */
  armed: boolean;
  confirm: string;
  deployer: boolean;
  onClose: () => void;
  onSaved: () => void;
  onSimulator: () => void;
}

/**
 * A driver's event cache, read through the core's `driver.cache view`: the queued events, each
 * with the cache's document, the whole cache saved as one simulator case (planned, shown, then
 * written where the simulator lists it), and the cache cleared — a deployer, the environment's
 * name typed, the count shown first; the core snapshots the cache before clearing it.
 */
export function CachePanel({ env, driver, armed, confirm, deployer, onClose, onSaved, onSimulator }: Props) {
  const [view, setView] = useState<CacheView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showXds, setShowXds] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("subscriber");
  const [replace, setReplace] = useState(false);
  const [plan, setPlan] = useState<CaseFiles | null>(null);
  const [cleared, setCleared] = useState<string | null>(null);

  const load = () => {
    setBusy("Reading the cache…");
    setError(null);
    api.vault
      .cache(env, driver)
      .then((v) => {
        setView(v);
        if (!v.ok) {
          setError(v.text);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  useEffect(load, [env, driver]);

  const planIt = (dryRun: boolean) => {
    setBusy(dryRun ? "Planning…" : "Writing…");
    api.vault
      .cacheCase(env, { driver, name: name || undefined, channel, replace, dryRun })
      .then((p) => {
        setPlan(p);
        if (p.ok && !name) {
          setName(p.name ?? "");
        }
        if (p.ok && p.written) {
          onSaved();
          onSimulator();
        }
      })
      .catch((e: Error) => setPlan({ ok: false, refusal: e.message }))
      .finally(() => setBusy(null));
  };
  const clear = () => {
    setBusy("Clearing…");
    setCleared(null);
    api.vault
      .cacheClear(env, driver, confirm)
      .then((r) => {
        setCleared(r.text);
        if (r.ok) {
          load();
        }
      })
      .catch((e: Error) => setCleared(e.message))
      .finally(() => setBusy(null));
  };

  const count = view?.count ?? 0;
  return (
    <aside className="setpanel cachepanel" data-testid="cache-panel">
      <div className="setpanel-head">
        <div>
          <div className="kicker">event cache</div>
          <h3>{driver}</h3>
          <div className="muted small">{view ? `${count} event(s) queued on ${env}` : busy ?? ""}</div>
        </div>
        <button className="linkish" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {view && view.ok && count > 0 && (
        <table className="grid" data-testid="cache-events">
          <thead>
            <tr>
              <th>#</th>
              <th>Operation</th>
              <th>Class</th>
              <th>Object</th>
            </tr>
          </thead>
          <tbody>
            {(view.events ?? []).map((e, i) => (
              <tr key={i}>
                <td className="muted small">{i + 1}</td>
                <td>
                  <span className={"pill ev-" + e.operation}>{e.operation}</span>
                </td>
                <td className="small">{e.className ?? ""}</td>
                <td className="small" title={e.eventId ?? ""}>
                  {e.srcDn ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {view && view.ok && count === 0 && <p className="muted small">The cache is empty: the driver has nothing waiting.</p>}
      <div className="addrow">
        <button onClick={load} disabled={busy !== null}>
          Refresh
        </button>
        {view?.cacheXds && (
          <button className="mini" onClick={() => setShowXds(!showXds)}>
            {showXds ? "hide cache document" : "cache document"}
          </button>
        )}
        <span className="spacer" />
        <button className="primary" disabled={count === 0 || busy !== null} onClick={() => setSaving(!saving)} data-testid="cache-save-case">
          Save as case…
        </button>
        {deployer && (
          <button className="danger" disabled={!armed || count === 0 || busy !== null} onClick={clear} title={armed ? `Discard the ${count} queued event(s); the core snapshots them first` : "Type the environment's name above first"} data-testid="cache-clear">
            Clear cache
          </button>
        )}
      </div>
      {busy && <span className="muted small">{busy}</span>}
      {cleared && <div className={cleared.includes("REFUSED") ? "banner error" : "banner"}>{cleared}</div>}
      {showXds && view?.cacheXds && <pre className="evdoc">{view.cacheXds}</pre>}
      {saving && (
        <div className="evcase" data-testid="cache-case">
          <label className="field wide">
            <em>Case name</em>
            <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="default: driver-cache-date" spellCheck={false} />
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
            <button onClick={() => planIt(true)} disabled={busy !== null}>
              Show the files
            </button>
            <button className="primary" onClick={() => planIt(false)} disabled={busy !== null || !plan || !plan.ok} data-testid="cache-write-case" title="Write the case where the simulator lists it, and open the simulator">
              Write and open the simulator
            </button>
          </div>
          {plan && !plan.ok && <div className="banner error">{plan.refusal}</div>}
          {plan && plan.ok && (
            <div className="small" data-testid="cache-case-plan">
              Would write <code>{plan.dir}</code>
              {plan.replaced ? " (replacing it)" : ""} with the cache's {plan.events} event(s) as one input document.
              {Object.entries(plan.files ?? {}).map(([file, content]) => (
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
