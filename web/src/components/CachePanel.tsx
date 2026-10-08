import { useEffect, useState } from "react";
import { api } from "../api";
import type { CacheEvent, CacheView, CaseFiles } from "../types";

interface Props {
  env: string;
  driver: string;
  /** the environment's name typed: driver control, the cache clear and a delete need it */
  armed: boolean;
  confirm: string;
  deployer: boolean;
  onClose: () => void;
  onSaved: () => void;
  onSimulator: () => void;
}

const PAGE = 200;

/**
 * A driver's event cache, read through the core's `driver.cache view` and shown in pages: pick an
 * event to see its document, export it, make a simulator case from it, or delete it (a deployer,
 * the environment's name typed, the event kept in deploy-snapshots first). The whole cache can be
 * exported as the merged cache document or as one simulator input — a recovery copy — saved as
 * one case, or cleared (the core snapshots it first).
 */
export function CachePanel({ env, driver, armed, confirm, deployer, onClose, onSaved, onSimulator }: Props) {
  const [view, setView] = useState<CacheView | null>(null);
  const [from, setFrom] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<CacheEvent | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [caseForm, setCaseForm] = useState({ name: "", channel: "subscriber", replace: false });
  const [plan, setPlan] = useState<CaseFiles | null>(null);
  const [savingOne, setSavingOne] = useState(false);
  const [onePlan, setOnePlan] = useState<CaseFiles | null>(null);

  const load = (at: number, fresh: boolean) => {
    setBusy("Reading the cache…");
    setError(null);
    api.vault
      .cache(env, driver, at, PAGE, fresh)
      .then((v) => {
        setView(v);
        setFrom(at);
        if (!v.ok) {
          setError(v.text ?? "the cache could not be read");
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  useEffect(() => load(0, false), [env, driver]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = view?.count ?? 0;
  const events = view?.events ?? [];
  const pages = Math.max(1, Math.ceil(count / PAGE));
  const page = Math.floor(from / PAGE) + 1;

  const exportOne = (e: CacheEvent) => {
    const blob = new Blob([e.xml ?? ""], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${driver}-event${e.index}-${e.operation}.xml`.replace(/[^A-Za-z0-9._-]+/g, "-");
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const finish = (p: CaseFiles, set: (p: CaseFiles) => void) => {
    set(p);
    if (p.ok && !caseForm.name) {
      setCaseForm({ ...caseForm, name: p.name ?? "" });
    }
    if (p.ok && p.written) {
      onSaved();
      onSimulator();
    }
  };
  const caseAll = (dryRun: boolean) => {
    setBusy(dryRun ? "Planning…" : "Writing…");
    api.vault
      .cacheCase(env, { driver, name: caseForm.name || undefined, channel: caseForm.channel, replace: caseForm.replace, dryRun })
      .then((p) => finish(p, setPlan))
      .catch((e: Error) => setPlan({ ok: false, refusal: e.message }))
      .finally(() => setBusy(null));
  };
  const caseOne = (e: CacheEvent, dryRun: boolean) => {
    setBusy(dryRun ? "Planning…" : "Writing…");
    api.vault
      .cacheEventCase(env, { driver, index: e.index, name: caseForm.name || undefined, channel: caseForm.channel, replace: caseForm.replace, dryRun })
      .then((p) => finish(p, setOnePlan))
      .catch((err: Error) => setOnePlan({ ok: false, refusal: err.message }))
      .finally(() => setBusy(null));
  };
  const deleteOne = (e: CacheEvent) => {
    setBusy(`Deleting event ${e.index}…`);
    setMessage(null);
    api.vault
      .cacheDeleteEvent(env, driver, e.index, confirm)
      .then((r) => {
        setMessage({ ok: r.ok, text: r.text });
        if (r.ok) {
          setPicked(null);
          load(from, true);
        }
      })
      .catch((err: Error) => setMessage({ ok: false, text: err.message }))
      .finally(() => setBusy(null));
  };
  const clear = () => {
    setBusy("Clearing…");
    setMessage(null);
    api.vault
      .cacheClear(env, driver, confirm)
      .then((r) => {
        setMessage({ ok: r.ok, text: r.text });
        if (r.ok) {
          setPicked(null);
          load(0, true);
        }
      })
      .catch((e: Error) => setMessage({ ok: false, text: e.message }))
      .finally(() => setBusy(null));
  };

  return (
    <aside className="setpanel cachepanel" data-testid="cache-panel">
      <div className="setpanel-head">
        <div>
          <div className="kicker">event cache</div>
          <h3>{driver}</h3>
          <div className="muted small">
            {view ? `${count} event(s) queued on ${env}` : (busy ?? "")}
            {view?.readAt ? ` · read ${view.readAt.replace("T", " ").slice(11, 19)}` : ""}
          </div>
        </div>
        <button className="linkish" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      <div className="addrow cacheactions" data-testid="cache-actions">
        <button onClick={() => load(from, true)} disabled={busy !== null} title="Read the cache again">
          Refresh
        </button>
        {count > 0 ? (
          <>
            <a className="button" href={api.vault.cacheFileUrl(env, driver, "cache")} download title="The whole cache as the engine's document (a recovery copy)" data-testid="cache-export">
              Export cache
            </a>
            <a className="button" href={api.vault.cacheFileUrl(env, driver, "input")} download title="The whole cache as one simulator input document">
              Export as input
            </a>
          </>
        ) : (
          <>
            <span className="button off">Export cache</span>
            <span className="button off">Export as input</span>
          </>
        )}
        <button className="primary" disabled={count === 0 || busy !== null} onClick={() => (setSavingAll(!savingAll), setSavingOne(false))} data-testid="cache-save-case">
          Whole cache as a case…
        </button>
        {deployer && (
          <button className="danger" disabled={!armed || count === 0 || busy !== null} onClick={clear} title={armed ? `Discard all ${count} queued event(s); the core snapshots them first` : "Type the environment's name above first"} data-testid="cache-clear">
            Clear cache
          </button>
        )}
        {busy && <span className="muted small">{busy}</span>}
      </div>
      {error && <div className="banner error">{error}</div>}
      {message && <div className={message.ok ? "banner" : "banner error"}>{message.text}</div>}
      {savingAll && <CaseForm label={`the whole cache (${count} events) as one case`} form={caseForm} setForm={setCaseForm} plan={plan} busy={busy !== null} onPlan={() => caseAll(true)} onWrite={() => caseAll(false)} testid="cache-case" />}
      {view && view.ok && count === 0 && <p className="muted small">The cache is empty: the driver has nothing waiting.</p>}
      {view && view.ok && count > 0 && (
        <div className="cachebody">
          <div className="cachelist">
            {pages > 1 && (
              <div className="addrow small">
                <button className="mini" disabled={page <= 1 || busy !== null} onClick={() => load(from - PAGE, false)}>
                  ◀
                </button>
                <span className="muted">
                  page {page} of {pages} · events {from + 1}–{Math.min(count, from + PAGE)}
                </span>
                <button className="mini" disabled={page >= pages || busy !== null} onClick={() => load(from + PAGE, false)}>
                  ▶
                </button>
              </div>
            )}
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
                {events.map((e) => (
                  <tr key={e.index} className={"clickable" + (picked?.index === e.index ? " selected" : "")} onClick={() => (setPicked(e), setOnePlan(null), setSavingOne(false))}>
                    <td className="muted small">{e.index}</td>
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
          </div>
          {picked && (
            <div className="cacheevent" data-testid="cache-event">
              <div className="setpanel-head">
                <div>
                  <div className="kicker">
                    event {picked.index} · {picked.operation} · {picked.className ?? ""}
                  </div>
                  <h3 title={picked.srcDn ?? ""}>{picked.srcDn ? picked.srcDn.slice(picked.srcDn.lastIndexOf("\\") + 1) : picked.eventId}</h3>
                  <div className="muted small">{picked.eventId ? `event-id ${picked.eventId}` : ""}</div>
                </div>
                <button className="linkish" onClick={() => setPicked(null)} title="Close">
                  ✕
                </button>
              </div>
              <div className="addrow">
                <button onClick={() => exportOne(picked)} title="Download this event's document" data-testid="cache-event-export">
                  Export
                </button>
                <button className="primary" onClick={() => (setSavingOne(!savingOne), setSavingAll(false))} data-testid="cache-event-case">
                  As a simulator case…
                </button>
                {deployer && (
                  <button className="danger" disabled={!armed || busy !== null} onClick={() => deleteOne(picked)} title={armed ? `Delete event ${picked.index} from the cache; its document is kept in deploy-snapshots first` : "Type the environment's name above first"} data-testid="cache-event-delete">
                    Delete this event
                  </button>
                )}
              </div>
              {savingOne && <CaseForm label={`event ${picked.index} as a case`} form={caseForm} setForm={setCaseForm} plan={onePlan} busy={busy !== null} onPlan={() => caseOne(picked, true)} onWrite={() => caseOne(picked, false)} testid="cache-event-caseform" />}
              <pre className="evdoc" data-testid="cache-event-xml">
                {picked.xml}
              </pre>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function CaseForm({ label, form, setForm, plan, busy, onPlan, onWrite, testid }: { label: string; form: { name: string; channel: string; replace: boolean }; setForm: (f: { name: string; channel: string; replace: boolean }) => void; plan: CaseFiles | null; busy: boolean; onPlan: () => void; onWrite: () => void; testid: string }) {
  return (
    <div className="evcase" data-testid={testid}>
      <div className="small muted">{label}</div>
      <label className="field wide">
        <em>Case name</em>
        <input value={form.name} onChange={(ev) => setForm({ ...form, name: ev.target.value })} placeholder="default: driver-…-date" spellCheck={false} />
      </label>
      <label className="field">
        <em>Channel</em>
        <select value={form.channel} onChange={(ev) => setForm({ ...form, channel: ev.target.value })}>
          <option value="subscriber">subscriber</option>
          <option value="publisher">publisher</option>
        </select>
      </label>
      <label className="checkchip">
        <input type="checkbox" checked={form.replace} onChange={(ev) => setForm({ ...form, replace: ev.target.checked })} /> replace an existing case
      </label>
      <div className="addrow">
        <button onClick={onPlan} disabled={busy}>
          Show the files
        </button>
        <button className="primary" onClick={onWrite} disabled={busy || !plan || !plan.ok} title="Write the case where the simulator lists it, and open the simulator">
          Write and open the simulator
        </button>
      </div>
      {plan && !plan.ok && <div className="banner error">{plan.refusal}</div>}
      {plan && plan.ok && (
        <div className="small">
          Would write <code>{plan.dir}</code>
          {plan.replaced ? " (replacing it)" : ""} with {plan.events} event(s).
          {Object.entries(plan.files ?? {}).map(([file, content]) => (
            <details key={file}>
              <summary>{file}</summary>
              <pre className="evdoc">{content}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
