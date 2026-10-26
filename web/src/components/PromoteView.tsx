import { DiffEditor } from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { monacoTheme } from "../monaco";
import type { KnownDecision, PromoteBucket, PromoteCompare, PromoteItem, PromoteResult, Selection } from "../types";

const LABEL: Record<PromoteBucket, string> = {
  pending: "pending",
  both: "both changed",
  own: "this project's own",
  unpaired: "not paired yet",
  known: "known",
  unchanged: "unchanged since the record",
};

const HINT: Record<PromoteBucket, string> = {
  pending: "Changed in the other project since it was last promoted; this project's copy is as that promotion left it",
  both: "Changed in both projects since the last promotion: compare the two before choosing",
  own: "Changed only in this project since the last promotion: left alone unless you tick it",
  unpaired: "The pair has no record of it yet: a plain difference",
  known: "Accepted as it is (promote.accept), and unchanged since",
  unchanged: "Neither project changed it since the last promotion",
};

const PILL: Record<PromoteBucket, string> = {
  pending: "pill warn small",
  both: "pill err small",
  own: "pill small",
  unpaired: "pill small",
  known: "pill ok small",
  unchanged: "pill ok small",
};

const OPEN: PromoteBucket[] = ["pending", "both", "own", "unpaired"];

/**
 * A project per environment (docs/project-per-environment.md): this project compared with another, each difference
 * sorted by the pair's promotion record, and the chosen files and values promoted into a new branch of this project.
 * Both sides are their base branches as the repository has them. Files are compared with their values set aside;
 * a value moves only when ticked.
 */
export function PromoteView({ initialFrom, editor, onSelect, onWorkspaceChanged }: { initialFrom?: string; editor: boolean; onSelect: (s: Selection) => void; onWorkspaceChanged: (next: Selection) => void }) {
  const [projects, setProjects] = useState<{ project: string; base: string; inPlace: boolean; projects: { name: string; base: string }[] } | null>(null);
  const [from, setFrom] = useState(initialFrom ?? "");
  const [result, setResult] = useState<PromoteCompare | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<PromoteResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [take, setTake] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [resets, setResets] = useState(0);
  const [showSettled, setShowSettled] = useState(false);
  // differences accepted as known, and known ones no longer accepted: committed with the promotion (or alone)
  const [known, setKnown] = useState<Record<string, KnownDecision>>({});
  const [forget, setForget] = useState<Set<string>>(new Set());
  // pairing: the map under review, and what pairing does with each difference (taken as it is by default)
  const [pairing, setPairing] = useState<{ file: string; current: string | null; text: string } | null>(null);
  const [pairChoice, setPairChoice] = useState<Record<string, "pending" | "known">>({});

  useEffect(() => {
    api.promote
      .projects()
      .then((p) => {
        setProjects(p);
        const first = p.projects[0];
        if (!from && first) {
          setFrom(first.name);
        }
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const compare = async (which: string, mapText?: string) => {
    setBusy(`Reading ${projects?.base ?? "the base branch"} of both projects and comparing…`);
    setError(null);
    setRefused(null);
    setKnown({});
    setForget(new Set());
    setPairChoice({});
    try {
      const r = await api.promote.compare(which, mapText);
      setResult(r);
      // pending files to begin with; never a value, never this project's own or both-changed
      setTake(new Set(r.items.filter((i) => i.kind === "file" && i.bucket === "pending").map((i) => i.path)));
      setEdits({});
      const first = r.items.find((i) => OPEN.includes(i.bucket));
      setSelected(first ? first.path : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (initialFrom) {
      void compare(initialFrom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => (result?.items ?? []).filter((i) => showSettled || OPEN.includes(i.bucket)), [result, showSettled]);
  const settled = (result?.items ?? []).filter((i) => !OPEN.includes(i.bucket)).length;
  const groups = useMemo(() => {
    const m = new Map<string, PromoteItem[]>();
    for (const i of shown) {
      const k = i.driver ?? "";
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  }, [shown]);
  const item = result?.items.find((i) => i.path === selected) ?? null;
  const counts = useMemo(() => {
    const c: Partial<Record<PromoteBucket, number>> = {};
    for (const i of result?.items ?? []) {
      c[i.bucket] = (c[i.bucket] ?? 0) + 1;
    }
    return c;
  }, [result]);

  const toggle = (path: string, on: boolean) => {
    const next = new Set(take);
    if (on) {
      next.add(path);
    } else {
      next.delete(path);
    }
    setTake(next);
  };
  const ticked = (result?.items ?? []).filter((i) => take.has(i.path));
  const files = ticked.filter((i) => i.kind === "file");
  const values = ticked.filter((i) => i.kind === "value");
  const isMerged = (i: PromoteItem) => edits[i.path] !== undefined && edits[i.path] !== i.after;
  const mergeable = !!item && item.kind === "file" && !item.binary && item.before != null && item.after != null;

  // a driver's driver.xml lists its files, library.xml the Library's, driverset.xml the drivers and the rest: a file added
  // or removed is refused without its manifest when that differs too, so say so before
  const split = useMemo(() => {
    const out = new Set<string>();
    for (const f of files) {
      const m = manifestOf(f.path);
      if (f.state !== "differs" && m !== f.path && !take.has(m) && (result?.items ?? []).some((i) => i.path === m)) {
        out.add(m);
      }
    }
    return [...out];
  }, [result, files, take]);

  /** Pairing: the map file as it is, or a proposal (look-alike drivers, nearest servers), compared with. */
  const startPairing = async () => {
    setBusy("Proposing a map…");
    setError(null);
    try {
      const m = await api.promote.map(from);
      const text = m.current ?? m.proposed;
      setPairing({ file: m.file, current: m.current, text });
      setShowSettled(true);
      await compare(from, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const pair = async () => {
    if (!result || !pairing) {
      return;
    }
    setBusy("Pairing into a new branch…");
    setError(null);
    setRefused(null);
    try {
      const pending = Object.entries(pairChoice).filter(([, c]) => c === "pending").map(([p]) => p);
      const accepted: Record<string, KnownDecision> = Object.fromEntries(Object.entries(pairChoice).filter(([, c]) => c === "known").map(([p]) => [p, { decision: "intended" }]));
      const r = await api.promote.pair(from, result.revision, pairing.text, pending, accepted);
      if (!r.ok) {
        setRefused(r);
        return;
      }
      onWorkspaceChanged({ type: "changes", against: "base" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const decide = (path: string, d: KnownDecision | null) => setKnown(({ [path]: _drop, ...rest }) => (d ? { ...rest, [path]: d } : rest));
  const decisions = Object.keys(known).length + forget.size;

  const promote = async () => {
    if (!result) {
      return;
    }
    setBusy(files.length + values.length > 0 ? `Promoting ${files.length} file(s)${values.length ? ` and ${values.length} value(s)` : ""} into a new branch…` : "Recording the decisions in a new branch…");
    setError(null);
    setRefused(null);
    try {
      const contents: Record<string, string> = {};
      for (const f of files) {
        const text = edits[f.path];
        if (text !== undefined && isMerged(f)) {
          contents[f.path] = text;
        }
      }
      const r = await api.promote.apply(from, result.revision, files.filter((f) => !isMerged(f)).map((f) => f.path), values.map((v) => v.path), contents, known, [...forget]);
      if (!r.ok) {
        setRefused(r);
        return;
      }
      // the session is on the new branch: show what its pull request would carry
      onWorkspaceChanged({ type: "changes", against: "base" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const others = projects?.projects ?? [];
  return (
    <div className="pad" data-testid="promote-view">
      <h2>Compare with project</h2>
      <p className="muted small">
        This project ({projects?.project ?? "…"}) compared with another, both as their {projects?.base ?? "base"} branches hold them. Each difference is sorted by the pair's
        promotion record (<code>promotions/&lt;project&gt;.json</code> in this tree). Promoting writes the files you tick into a new branch of this project, with this project's
        values kept unless you tick them too, and pushes it for review.
      </p>
      {projects && others.length === 0 && <p className="muted">This server holds no other project to compare with.</p>}
      {others.length > 0 && (
        <div className="addrow">
          <label>
            Compare with{" "}
            <select value={from} onChange={(e) => setFrom(e.target.value)} data-testid="promote-from">
              {others.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={() => (onSelect({ type: "promote", from }), void compare(from))} disabled={!from || busy !== null} data-testid="promote-compare">
            {result ? "Compare again" : "Compare"}
          </button>
          {busy && (
            <span className="busy-line">
              <span className="spinner" /> {busy}
            </span>
          )}
        </div>
      )}
      {error && <p className="err-text">{error}</p>}
      {result && (
        <>
          <p className="small" data-testid="promote-sides">
            {result.target.project} at {short(result.target.commit)} compared with {result.source.project} at {short(result.source.commit)}.{" "}
            {OPEN.map((b) => (counts[b] ? `${counts[b]} ${LABEL[b]}` : null))
              .filter(Boolean)
              .join(", ") || "Nothing to promote."}
          </p>
          {!result.paired && !pairing && (
            <p className="warn-text small" data-testid="promote-unpaired">
              The pair has no promotion record yet, so every difference is shown plain; each promotion records what it moved.{" "}
              {editor && (
                <button onClick={() => void startPairing()} disabled={busy !== null} data-testid="promote-pair-start">
                  Pair with {from}…
                </button>
              )}{" "}
              Pairing records both projects as they are now, so from then on only new changes show.
            </p>
          )}
          {pairing && (
            <div className="banner" data-testid="promote-pairing">
              <p className="small">
                <strong>Pair with {result.source.project}.</strong> The map in <code>{pairing.file}</code>
                {pairing.current === null ? ", proposed from drivers that look alike and servers with the nearest names" : ", as the file holds it"}: one line each,{" "}
                <code>drivers/&lt;{result.source.project}'s name&gt;.name = &lt;this project's&gt;</code> and{" "}
                <code>servers.&lt;{result.source.project}'s server&gt; = &lt;this project's server's DN&gt;</code>. Compare again after a change. Below, every difference is taken as it is
                unless you leave it pending (so it shows for promotion) or accept it as known.
              </p>
              <textarea className="code" rows={Math.min(10, Math.max(3, pairing.text.split("\n").length + 1))} value={pairing.text} onChange={(e) => setPairing({ ...pairing, text: e.target.value })} spellCheck={false} style={{ width: "100%" }} data-testid="promote-pair-map" />
              <div className="addrow">
                <button onClick={() => void compare(from, pairing.text)} disabled={busy !== null} data-testid="promote-pair-compare">
                  Compare with this map
                </button>
                <button className="primary" onClick={() => void pair()} disabled={busy !== null} data-testid="promote-pair-apply">
                  Pair: {Object.values(pairChoice).filter((c) => c === "pending").length} pending, {Object.values(pairChoice).filter((c) => c === "known").length} known…
                </button>
                <button className="link" onClick={() => (setPairing(null), void compare(from))} disabled={busy !== null}>
                  cancel
                </button>
                <span className="muted small">Into a new branch, promote/{result.pair}-pair-&lt;time&gt;, with the map and the record, pushed for review.</span>
              </div>
            </div>
          )}
          {!pairing && !result.map && result.matches.length > 0 && (
            <div className="small" data-testid="promote-matches">
              Drivers only one project has that look alike under other names. If they are one driver, map them in <code>promotions/{result.pair}.properties</code>:
              <ul className="plain">
                {result.matches.map((m) => (
                  <li key={m.source}>
                    <code>
                      drivers/{m.source}.name = {m.target}
                    </code>{" "}
                    <span className="muted">
                      ({m.common} of {m.of} policies in common)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.notes.length > 0 && (
            <ul className="plain small">
              {result.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <div className="promote-body">
            <div className="promote-side">
              {editor && shown.length > 0 && (
                <div className="addrow tight small">
                  tick:
                  <button className="link" onClick={() => setTake(new Set(result.items.filter((i) => i.kind === "file" && i.bucket === "pending").map((i) => i.path)))}>
                    pending files
                  </button>
                  <button className="link" onClick={() => setTake(new Set())}>
                    none
                  </button>
                </div>
              )}
              {groups.map(([driver, list]) => (
                <div key={driver || "-"}>
                  <h4>{driver || "Driver set and Library"}</h4>
                  <ul className="filelist pickable">
                    {list.map((i) => (
                      <li key={i.path}>
                        {editor && pairing && (
                          <select
                            className="small"
                            value={pairChoice[i.path] ?? ""}
                            onChange={(e) => setPairChoice(({ [i.path]: _drop, ...rest }) => (e.target.value ? { ...rest, [i.path]: e.target.value as "pending" | "known" } : rest))}
                            title="What pairing records for this difference"
                            data-testid={"promote-pair-choice-" + i.path}
                          >
                            <option value="">as it is</option>
                            <option value="pending">leave pending</option>
                            <option value="known">known</option>
                          </select>
                        )}
                        {editor && !pairing && <input type="checkbox" checked={take.has(i.path)} onChange={(e) => toggle(i.path, e.target.checked)} title={i.kind === "value" ? "Take the other project's value" : "Promote this file"} data-testid={"promote-take-" + i.path} />}
                        <button className={i.path === selected ? "leaf active" : "leaf"} onClick={() => setSelected(i.path)} title={i.path}>
                          {i.kind === "value" ? <span className="badge">V</span> : <span className={"badge st-" + (i.state === "only in the source" ? "added" : i.state === "only in the target" ? "deleted" : "changed")}>{i.state === "only in the source" ? "A" : i.state === "only in the target" ? "D" : "M"}</span>}
                          {i.kind === "value" ? i.path.replace(/^drivers\/[^.]*\.|^driverset\./, "") : i.path.split("/").slice(-2).join("/")}{" "}
                          <span className={PILL[i.bucket]} title={HINT[i.bucket]}>
                            {LABEL[i.bucket]}
                          </span>
                          {i.changedSinceKnown && <span className="pill small" title="Accepted as known once, changed since"> changed since known</span>}
                          {isMerged(i) && <span className="pill small"> merged</span>}
                          {known[i.path] && <span className="pill ok small"> → known</span>}
                          {forget.has(i.path) && <span className="pill warn small"> → not known</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {settled > 0 && (
                <button className="link small" onClick={() => setShowSettled(!showSettled)} data-testid="promote-settled">
                  {showSettled ? "hide" : "show"} {settled} known or unchanged since the record
                </button>
              )}
            </div>
            <div className="promote-diff">
              {item && editor && !pairing && (
                <div className="addrow tight small" data-testid="promote-decide">
                  {item.bucket === "known" ? (
                    <button className="link" onClick={() => setForget((cur) => (cur.has(item.path) ? new Set([...cur].filter((x) => x !== item.path)) : new Set(cur).add(item.path)))}>
                      {forget.has(item.path) ? "keep it known" : "no longer known"}
                    </button>
                  ) : known[item.path] ? (
                    <button className="link" onClick={() => decide(item.path, null)}>
                      don't accept it
                    </button>
                  ) : (
                    <>
                      accept as known:
                      <button className="link" onClick={() => decide(item.path, { decision: "intended" })} title="Different on purpose: collapsed until either project changes it">
                        intended
                      </button>
                      <button className="link" onClick={() => decide(item.path, { decision: "later" })} title="Set aside for now, to decide later">
                        to decide later
                      </button>
                    </>
                  )}
                </div>
              )}
              {item && item.kind === "value" && (
                <table className="kv" data-testid="promote-value">
                  <tbody>
                    <tr>
                      <th>Value</th>
                      <td>
                        <code>{item.path}</code>
                      </td>
                    </tr>
                    <tr>
                      <th>{result.target.project} (this project)</th>
                      <td>{item.target ?? <span className="muted">(none)</span>}</td>
                    </tr>
                    <tr>
                      <th>{result.source.project}</th>
                      <td>{item.source ?? <span className="muted">(none)</span>}</td>
                    </tr>
                  </tbody>
                  <caption className="muted small">Values stay this project's unless ticked: a promoted policy brings its logic, not the other project's URL.</caption>
                </table>
              )}
              {item && item.kind === "file" && item.binary && <p className="muted pad">This file is not shown as text.</p>}
              {item && item.kind === "file" && !item.binary && (
                <>
                  <div className="addrow tight small mergebar">
                    <span className="muted">
                      Left: {result.target.project} now. Right: what promoting writes, {result.source.project}'s with this project's values.
                      {mergeable ? " The arrow beside a block keeps this project's lines there; you can also edit the right side." : ""}
                    </span>
                    <span className="spacer" />
                    {mergeable && (
                      <>
                        <button className="link" onClick={() => (setEdits(({ [item.path]: _drop, ...rest }) => rest), setResets(resets + 1))} disabled={!isMerged(item)}>
                          take all of {result.source.project}'s
                        </button>
                      </>
                    )}
                  </div>
                  <DiffEditor
                    key={item.path + ":" + resets}
                    height="calc(100% - 40px)"
                    language={item.language}
                    original={item.before ?? ""}
                    modified={edits[item.path] ?? item.after ?? ""}
                    theme={monacoTheme()}
                    options={{ readOnly: !mergeable || !editor, originalEditable: false, renderMarginRevertIcon: mergeable && editor, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: false, wordWrap: "on", diffWordWrap: "on", minimap: { enabled: false }, scrollBeyondLastLine: false }}
                    onMount={(ed) => {
                      if (!mergeable || !editor) {
                        return;
                      }
                      const path = item.path;
                      const modified = ed.getModifiedEditor();
                      modified.onDidChangeModelContent(() => {
                        const text = modified.getValue();
                        setEdits((cur) => ({ ...cur, [path]: text }));
                        setTake((cur) => new Set(cur).add(path));
                      });
                    }}
                  />
                </>
              )}
              {!item && <p className="muted pad">{result.items.length === 0 ? "The two projects hold the same." : "Pick a file or value."}</p>}
            </div>
          </div>
          {refused && (
            <div className="banner error" data-testid="promote-refused">
              Not promoted: {refused.refusal}
              {(refused.newErrors ?? []).length > 0 && (
                <ul className="plain small">
                  {(refused.newErrors ?? []).map((e, i) => (
                    <li key={i}>
                      {e.code} {e.path}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {split.length > 0 && (
            <p className="warn-text small" data-testid="promote-split">
              {split.join(", ")} {split.length === 1 ? "lists" : "list"} files you are adding or removing: tick {split.length === 1 ? "it" : "them"} too, or the promotion is refused.
            </p>
          )}
          {editor && pairing ? null : editor ? (
            <div className="addrow">
              <button className="primary" onClick={() => void promote()} disabled={busy !== null || (ticked.length === 0 && decisions === 0)} data-testid="promote-apply">
                {ticked.length > 0 ? `Promote ${files.length} file(s)${values.length ? ` and ${values.length} value(s)` : ""}` : "Record"}
                {decisions > 0 ? `${ticked.length > 0 ? "," : ""} ${decisions} decision(s)` : ""}…
              </button>
              <span className="muted small">
                Into a new branch, promote/{result.pair}-&lt;time&gt;, made from {result.target.base}: committed with the promotion record and pushed. The page then opens it, and
                the bar offers the pull request.
              </span>
            </div>
          ) : (
            <p className="muted small">Promoting needs the editor role.</p>
          )}
        </>
      )}
    </div>
  );
}

/** The manifest that lists a tree file (the core's Promote.manifestOf). */
function manifestOf(path: string): string {
  const parts = path.split("/");
  if (parts[0] === "drivers" && parts.length >= 3 && !(parts.length === 3 && parts[2] === "driver.xml")) {
    return `drivers/${parts[1]}/driver.xml`;
  }
  if (parts[0] === "library" && parts.length >= 2 && path !== "library/library.xml") {
    return "library/library.xml";
  }
  return "driverset.xml";
}

function short(commit: string | null): string {
  return commit ? commit.slice(0, 8) : "(no commit)";
}
