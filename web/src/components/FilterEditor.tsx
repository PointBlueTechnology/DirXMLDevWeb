import { useEffect, useState } from "react";
import { api } from "../api";
import { CHANNEL_MODES, MERGE_AUTHORITIES, parseFilter, type FilterClass } from "../configxml";
import type { Pending } from "../pending";

const MODE_GLYPH: Record<string, string> = { sync: "⇄", notify: "⚑", ignore: "∅", reset: "↺" };
const MODE_HELP: Record<string, string> = {
  sync: "sync: changes flow through this channel",
  notify: "notify: the change is reported to the policies but not written",
  ignore: "ignore: the channel does nothing with this attribute",
  reset: "reset: the channel's side is put back to the other side's value",
};
const AUTHORITY_GLYPH: Record<string, string> = { default: "·", edir: "⬅", app: "➡", none: "✕" };
const AUTHORITY_HELP: Record<string, string> = {
  default: "merge authority: default — the channel that synchronizes wins, both when both do",
  edir: "merge authority: the Identity Vault's value wins",
  app: "merge authority: the application's value wins",
  none: "merge authority: none — values are not merged",
};

interface Props {
  driver: string;
  file: string | null;
  revision: string;
  pending: Pending;
}

/** The driver filter: classes and attributes with each channel's setting (`filter.set-class`, `filter.set-attr`, and the removes). */
export function FilterEditor({ driver, file, revision, pending }: Props) {
  const [classes, setClasses] = useState<FilterClass[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newClass, setNewClass] = useState("");
  const [newAttr, setNewAttr] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!file) {
      setClasses([]);
      return;
    }
    let gone = false;
    api
      .file(file)
      .then((f) => {
        if (gone) {
          return;
        }
        const parsed = parseFilter(f.content);
        setClasses(parsed);
        setError(parsed ? null : "The filter document could not be read as a <filter>.");
      })
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [file, revision]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!classes) {
    return <p className="muted pad">Loading the filter…</p>;
  }

  const staged = (key: string) => pending.ops.find((o) => o.key === key);
  const removed = (key: string) => staged(key)?.name.includes("remove") ?? false;

  const classOp = (c: FilterClass, change: Partial<FilterClass>) => {
    const next = { publisher: staged(`fc:${c.name}`)?.args.publisher ?? c.publisher, subscriber: staged(`fc:${c.name}`)?.args.subscriber ?? c.subscriber, ...change };
    if (next.publisher === c.publisher && next.subscriber === c.subscriber) {
      pending.put(`fc:${c.name}`, null);
      return;
    }
    pending.put(`fc:${c.name}`, { name: "filter.set-class", args: { driver, class: c.name, publisher: next.publisher, subscriber: next.subscriber }, label: `class ${c.name}: publisher ${next.publisher}, subscriber ${next.subscriber}` });
  };

  const attrOp = (c: FilterClass, a: FilterClass["attrs"][number], change: Record<string, string>) => {
    const key = `fa:${c.name}:${a.name}`;
    const s = staged(key)?.args;
    const next = { publisher: s?.publisher ?? a.publisher, subscriber: s?.subscriber ?? a.subscriber, "merge-authority": s?.["merge-authority"] ?? a.mergeAuthority, ...change };
    if (next.publisher === a.publisher && next.subscriber === a.subscriber && next["merge-authority"] === a.mergeAuthority) {
      pending.put(key, null);
      return;
    }
    pending.put(key, { name: "filter.set-attr", args: { driver, class: c.name, attr: a.name, ...next }, label: `${c.name}.${a.name}: publisher ${next.publisher}, subscriber ${next.subscriber}` });
  };

  // each mode has a colour and a glyph so a filter reads at a glance: ⇄ sync, ⚑ notify, ∅ ignore, ↺ reset
  const mode = (value: string, onChange: (v: string) => void, changed: boolean) => (
    <span className={`modepick mode-${value}`} title={MODE_HELP[value] ?? value}>
      <span className="glyph" aria-hidden="true">{MODE_GLYPH[value] ?? "·"}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={changed ? "changed" : ""}>
        {!CHANNEL_MODES.includes(value as (typeof CHANNEL_MODES)[number]) && <option>{value}</option>}
        {CHANNEL_MODES.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
    </span>
  );
  const authority = (value: string, onChange: (v: string) => void) => (
    <span className={`modepick ma-${value}`} title={AUTHORITY_HELP[value] ?? value}>
      <span className="glyph" aria-hidden="true">{AUTHORITY_GLYPH[value] ?? "·"}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {MERGE_AUTHORITIES.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
    </span>
  );

  const addedClasses = pending.ops.filter((o) => o.key?.startsWith("fcnew:")).map((o) => o.args.class ?? "");

  return (
    <div className="pad">
      <p className="legend small" data-testid="filter-legend">
        <span className="modepick mode-sync"><span className="glyph">⇄</span> sync</span>
        <span className="modepick mode-notify"><span className="glyph">⚑</span> notify</span>
        <span className="modepick mode-ignore"><span className="glyph">∅</span> ignore</span>
        <span className="modepick mode-reset"><span className="glyph">↺</span> reset</span>
        <span className="muted"> · merge authority: </span>
        <span className="modepick ma-edir"><span className="glyph">⬅</span> vault wins</span>
        <span className="modepick ma-app"><span className="glyph">➡</span> app wins</span>
        <span className="modepick ma-none"><span className="glyph">✕</span> none</span>
      </p>
      {classes.length === 0 && addedClasses.length === 0 && <p className="muted">The filter has no classes: nothing synchronizes in either direction.</p>}
      {classes.map((c) => {
        const cs = staged(`fc:${c.name}`)?.args;
        const gone = removed(`fcdel:${c.name}`);
        return (
          <section key={c.name} className={gone ? "fclass removed" : "fclass"}>
            <header>
              <h3>{c.name}</h3>
              <label>
                publisher {mode(cs?.publisher ?? c.publisher, (v) => classOp(c, { publisher: v }), cs?.publisher !== undefined && cs.publisher !== c.publisher)}
              </label>
              <label>
                subscriber {mode(cs?.subscriber ?? c.subscriber, (v) => classOp(c, { subscriber: v }), cs?.subscriber !== undefined && cs.subscriber !== c.subscriber)}
              </label>
              <span className="spacer" />
              <button className="mini danger" onClick={() => pending.put(`fcdel:${c.name}`, gone ? null : { name: "filter.remove-class", args: { driver, class: c.name }, label: `remove class ${c.name} and its attributes` })}>
                {gone ? "keep" : "remove class"}
              </button>
            </header>
            <table className="defs">
              <thead>
                <tr>
                  <th>Attribute</th>
                  <th>Publisher</th>
                  <th>Subscriber</th>
                  <th>Merge authority</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {c.attrs.map((a) => {
                  const key = `fa:${c.name}:${a.name}`;
                  const s = staged(key)?.args;
                  const agone = removed(`fadel:${c.name}:${a.name}`);
                  return (
                    <tr key={a.name} className={agone ? "removed" : s ? "changed" : ""}>
                      <td>{a.name}</td>
                      <td>{mode(s?.publisher ?? a.publisher, (v) => attrOp(c, a, { publisher: v }), false)}</td>
                      <td>{mode(s?.subscriber ?? a.subscriber, (v) => attrOp(c, a, { subscriber: v }), false)}</td>
                      <td>{authority(s?.["merge-authority"] ?? a.mergeAuthority, (v) => attrOp(c, a, { "merge-authority": v }))}</td>
                      <td>
                        <button className="mini danger" title="Remove this attribute from the filter" onClick={() => pending.put(`fadel:${c.name}:${a.name}`, agone ? null : { name: "filter.remove-attr", args: { driver, class: c.name, attr: a.name }, label: `remove ${c.name}.${a.name}` })}>
                          {agone ? "keep" : "×"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {pending.ops
                  .filter((o) => o.key?.startsWith(`fanew:${c.name}:`))
                  .map((o) => (
                    <tr key={o.key} className="changed">
                      <td>{o.args.attr}</td>
                      <td>sync</td>
                      <td>sync</td>
                      <td>default</td>
                      <td>
                        <button className="mini" onClick={() => o.key && pending.put(o.key, null)}>
                          undo
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="addrow">
              <input placeholder="attribute (eDirectory name)" value={newAttr[c.name] ?? ""} onChange={(e) => setNewAttr({ ...newAttr, [c.name]: e.target.value })} />
              <button
                disabled={!(newAttr[c.name] ?? "").trim()}
                onClick={() => {
                  const attr = (newAttr[c.name] ?? "").trim();
                  pending.put(`fanew:${c.name}:${attr}`, { name: "filter.set-attr", args: { driver, class: c.name, attr, publisher: "sync", subscriber: "sync" }, label: `add ${c.name}.${attr} (sync both ways)` });
                  setNewAttr({ ...newAttr, [c.name]: "" });
                }}
              >
                Add attribute
              </button>
            </div>
          </section>
        );
      })}
      {addedClasses.map((name) => (
        <section key={name} className="fclass changed">
          <header>
            <h3>{name}</h3>
            <span className="muted small">new class, sync both ways — add its attributes after applying</span>
            <span className="spacer" />
            <button className="mini" onClick={() => pending.put(`fcnew:${name}`, null)}>
              undo
            </button>
          </header>
        </section>
      ))}
      <div className="addrow">
        <strong className="small">New class</strong>
        <input placeholder="class (eDirectory name, e.g. User)" value={newClass} onChange={(e) => setNewClass(e.target.value)} />
        <button
          disabled={!newClass.trim() || classes.some((c) => c.name === newClass.trim())}
          onClick={() => {
            const name = newClass.trim();
            pending.put(`fcnew:${name}`, { name: "filter.set-class", args: { driver, class: name, publisher: "sync", subscriber: "sync" }, label: `add class ${name} (sync both ways)` });
            setNewClass("");
          }}
        >
          Add class
        </button>
      </div>
    </div>
  );
}
