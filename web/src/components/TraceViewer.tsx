import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, followTrace, tokenForLink } from "../api";
import { ALL, CHANNELS, MARKERS, TIMESTAMP_FORMATS, compact as compactRec, findRanges, lineCount, markerRow, matches, parseTimeOfDay, rowAtTime, segments, withTimestamp, type ChannelCode, type Filter, type Segment, type TimestampFormat, type TraceRec } from "../trace/model";
import type { Outline, Selection } from "../types";

interface Props {
  /** live trace of this environment (one of env or file) */
  env?: string;
  /** a recording or an uploaded file on the server, read in pages */
  file?: string;
  /** the tree's driver names, offered in the driver filter before any trace arrives */
  drivers: string[];
  /** rendered alone in its own window: no pop-out button */
  popout?: boolean;
  /** the tree, for links: a driver name or a policy name in the trace opens it */
  outline?: Outline | null;
  onSelect?: (s: Selection) => void;
  onOpen?: (path: string) => void;
}

interface Settings {
  bufferMax: number;
  shownMax: number;
  wrap: boolean;
  font: number;
  compact: boolean;
  ts: TimestampFormat;
}

const DEFAULTS: Settings = { bufferMax: 50000, shownMax: 15000, wrap: false, font: 12, compact: false, ts: "US" };
const KEY = "idmweb.trace.settings";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/**
 * Live trace with the desktop viewer's features, on the same parser and highlighting (the
 * records arrive parsed from `dirxml-trace-core`): channel, driver and text filters, find with
 * every match marked, compact whitespace, timestamp formats, pause (the buffer keeps filling),
 * save and copy of what is shown, wrap, font size, buffer sizes. The list is virtualised by line
 * count, so fifteen thousand records with XML bodies scroll without the DOM holding them all.
 */
export function TraceViewer({ env, file, drivers, popout, outline, onSelect, onOpen }: Props) {
  const popOut = () => {
    const tok = tokenForLink();
    const target = file ? `file=${encodeURIComponent(file)}` : `env=${encodeURIComponent(env ?? "")}`;
    const url = `${window.location.pathname}${window.location.search}#type=trace&${target}&popout=1${tok ? `&token=${tok}` : ""}`;
    window.open(url, "_blank", "popup=yes,width=1280,height=860");
  };
  // links into the tree: a driver by its name, a policy by its name (any driver's, or the Library's)
  const driverSet = useMemo(() => new Set(drivers), [drivers]);
  const policyPaths = useMemo(() => {
    const m = new Map<string, string>();
    if (outline) {
      for (const d of outline.drivers) {
        for (const p of [...d.policies.driver, ...d.policies.subscriber, ...d.policies.publisher]) {
          m.set(p.name, p.path);
        }
      }
      for (const p of outline.library.policies) {
        m.set(p.name, p.path);
      }
    }
    return m;
  }, [outline]);
  const linkFor = (s: Segment): (() => void) | null => {
    const t = s.text.trim();
    if (!t) {
      return null;
    }
    if (s.token === "DRIVER" && onSelect && driverSet.has(t)) {
      return () => onSelect({ type: "config", driver: t });
    }
    const path = policyPaths.get(t);
    return path && onOpen ? () => onOpen(path) : null;
  };
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // per-viewer convenience only
    }
  };

  // the stream
  const [servers, setServers] = useState<{ dn: string; name: string; url: string | null; primary: boolean }[] | null>(null);
  const [server, setServer] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "open" | "closed">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [streamErrors, setStreamErrors] = useState<string[]>([]);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!env) {
      setServers([]);
      return;
    }
    api.vault
      .servers(env)
      .then((r) => setServers(r.servers))
      .catch(() => setServers([]));
  }, [env]);
  const [record, setRecord] = useState(false);
  const [recording, setRecording] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<{ matched: number; total: number; drivers: string[] } | null>(null);

  // the buffer: records arrive on the stream's thread of events; the view re-renders at most every 100 ms
  const buffer = useRef<TraceRec[]>([]);
  const seenDrivers = useRef<Set<string>>(new Set());
  const [, bump] = useState(0);
  const dirty = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      if (dirty.current) {
        dirty.current = false;
        bump((n) => n + 1);
      }
    }, 100);
    return () => clearInterval(id);
  }, []);
  const push = useCallback(
    (r: TraceRec) => {
      const b = buffer.current;
      b.push(r);
      if (b.length > settings.bufferMax) {
        b.splice(0, b.length - settings.bufferMax);
      }
      if (r.d && !seenDrivers.current.has(r.d)) {
        seenDrivers.current.add(r.d);
      }
      dirty.current = true;
    },
    [settings.bufferMax],
  );

  const end = () => {
    stop.current?.();
    stop.current = null;
  };
  useEffect(() => end, []);
  const start = () => {
    if (!env) {
      return;
    }
    end();
    setFailure(null);
    setStreamErrors([]);
    setRecording(null);
    setState("connecting");
    stop.current = followTrace(
      env,
      null,
      true,
      (r) => {
        if ("error" in r) {
          setStreamErrors((e) => [...e, String(r.error)]);
          return;
        }
        push(r);
      },
      (s) => {
        if (typeof s === "object") {
          if ("failed" in s) {
            setFailure(s.failed);
            setState("closed");
          } else {
            setRecording(s.recording);
          }
        } else {
          setState(s);
        }
      },
      server || undefined,
      record,
    );
  };
  const running = state === "connecting" || state === "open";
  const clear = () => {
    buffer.current = [];
    dirty.current = true;
    bump((n) => n + 1);
  };

  // filters (hide) and find (mark)
  const [channels, setChannels] = useState<Set<ChannelCode>>(new Set(ALL.channels));
  const [driverSel, setDriverSel] = useState<Set<string> | null>(null);
  const [text, setText] = useState("");
  const filter: Filter = useMemo(() => ({ channels, drivers: driverSel, text }), [channels, driverSel, text]);
  const [fileBusy, setFileBusy] = useState(false);
  const loadFile = useCallback(() => {
    if (!file) {
      return;
    }
    setFileBusy(true);
    setFailure(null);
    const letters = channels.size === 4 ? undefined : [...channels].join("");
    const oneDriver = driverSel && driverSel.size === 1 ? [...driverSel][0] : undefined;
    api.traces
      .records(file, 0, settings.bufferMax, { channels: letters, driver: oneDriver, text: text.trim() || undefined })
      .then((r) => {
        buffer.current = r.records;
        r.drivers.forEach((d) => seenDrivers.current.add(d));
        setFileInfo({ matched: r.matched, total: r.total, drivers: r.drivers });
        dirty.current = true;
        bump((n) => n + 1);
        setState("open");
      })
      .catch((e: Error) => setFailure(e.message))
      .finally(() => setFileBusy(false));
  }, [file, channels, driverSel, text, settings.bufferMax]);
  useEffect(() => {
    if (!file) {
      return;
    }
    const id = setTimeout(loadFile, 250);
    return () => clearTimeout(id);
  }, [file, loadFile]);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const frozen = useRef<TraceRec[] | null>(null);

  const shown: TraceRec[] = useMemo(() => {
    if (paused && frozen.current) {
      return frozen.current;
    }
    const out: TraceRec[] = [];
    const b = buffer.current;
    for (let i = b.length - 1; i >= 0 && out.length < settings.shownMax; i--) {
      if (matches(filter, b[i]!)) {
        out.push(b[i]!);
      }
    }
    out.reverse();
    if (paused) {
      frozen.current = out;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, settings.shownMax, paused, buffer.current.length, dirty.current]);
  useEffect(() => {
    if (!paused) {
      frozen.current = null;
    }
  }, [paused]);

  // what each shown record renders as: timestamp format and compacting applied, line count for the layout
  const prepared = useMemo(() => {
    const rows = shown.map((r) => {
      let x = withTimestamp(r, settings.ts);
      if (settings.compact) {
        x = compactRec(x);
      }
      return { rec: x, lines: lineCount(x.x) };
    });
    return rows;
  }, [shown, settings.ts, settings.compact]);

  // find: every match, across the shown records
  const hits = useMemo(() => {
    const out: { row: number; ranges: [number, number][] }[] = [];
    if (query) {
      prepared.forEach((p, i) => {
        const ranges = findRanges(p.rec.x, query);
        if (ranges.length > 0) {
          out.push({ row: i, ranges });
        }
      });
    }
    return out;
  }, [prepared, query]);
  const hitCount = hits.reduce((n, h) => n + h.ranges.length, 0);
  const hitRows = useMemo(() => {
    const m = new Map<number, [number, number][]>();
    hits.forEach((h) => m.set(h.row, h.ranges));
    return m;
  }, [hits]);
  const flatHits = useMemo(() => hits.flatMap((h) => h.ranges.map((r) => ({ row: h.row, range: r }))), [hits]);
  useEffect(() => setCurrent(0), [query]);
  const step = (by: number) => {
    if (flatHits.length === 0) {
      return;
    }
    const next = (current + by + flatHits.length) % flatHits.length;
    setCurrent(next);
    setFollow(false);
    scrollToRow(flatHits[next]!.row);
  };

  // the virtual list: heights from line counts (exact without wrap; a wrapped line counts once more per 160 columns)
  const lineHeight = Math.round(settings.font * 1.45);
  const heights = useMemo(() => prepared.map((p) => (settings.wrap ? p.lines + Math.floor(p.rec.x.length / 160) : p.lines) * lineHeight), [prepared, settings.wrap, lineHeight]);
  const offsets = useMemo(() => {
    const o = new Array<number>(heights.length + 1);
    o[0] = 0;
    for (let i = 0; i < heights.length; i++) {
      o[i + 1] = o[i]! + heights[i]!;
    }
    return o;
  }, [heights]);
  const total = offsets[offsets.length - 1] ?? 0;
  const box = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const [follow, setFollow] = useState(true);
  const onScroll = () => {
    const el = box.current;
    if (!el) {
      return;
    }
    setView({ top: el.scrollTop, height: el.clientHeight });
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - lineHeight * 2;
    if (!atEnd && follow) {
      setFollow(false);
    }
  };
  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow) {
      el.scrollTop = el.scrollHeight;
    }
  }, [total, follow]);
  useEffect(() => {
    const el = box.current;
    if (el) {
      setView({ top: el.scrollTop, height: el.clientHeight });
    }
  }, []);
  const scrollToRow = (row: number) => {
    const el = box.current;
    if (el) {
      el.scrollTop = Math.max(0, (offsets[row] ?? 0) - el.clientHeight / 3);
      // the rows to render follow now, not when the scroll event arrives (it may come late, or not
      // at all when the position did not change)
      setView({ top: el.scrollTop, height: el.clientHeight });
    }
  };
  const first = Math.max(0, lowerBound(offsets, view.top) - 1);
  const last = Math.min(prepared.length, lowerBound(offsets, view.top + view.height) + 1);

  // jump markers (#2 of the trace viewer): from the record last landed on while it is in view, else from the top of the view
  const [jumpKind, setJumpKind] = useState("POLICY");
  const [landed, setLanded] = useState<TraceRec | null>(null);
  const [jumpNote, setJumpNote] = useState<string | null>(null);
  const [timeText, setTimeText] = useState("");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (s: string) => {
    setJumpNote(s);
    if (noteTimer.current) {
      clearTimeout(noteTimer.current);
    }
    noteTimer.current = setTimeout(() => setJumpNote(null), 3000);
  };
  const land = (row: number) => {
    setFollow(false);
    setLanded(shown[row]!);
    setJumpNote(null);
    scrollToRow(row);
  };
  const jump = (dir: 1 | -1 | 0) => {
    const at = landed ? shown.indexOf(landed) : -1;
    const base = at >= first && at < last ? at : first;
    const row = markerRow(shown, jumpKind, base, dir);
    const label = (MARKERS.find((m) => m.code === jumpKind)?.label ?? jumpKind).toLowerCase();
    if (row < 0) {
      say(`no ${dir === 1 ? "later " : dir === -1 ? "earlier " : ""}${label} shown`);
    } else {
      land(row);
    }
  };
  const goToTime = () => {
    const ms = parseTimeOfDay(timeText);
    if (ms < 0) {
      say("not a time of day: try 10:15 or 10:15:12.345");
      return;
    }
    const row = rowAtTime(shown, ms);
    if (row < 0) {
      say(`nothing shown at or after ${timeText.trim()}`);
    } else {
      land(row);
    }
  };

  // save and copy what is shown
  const shownText = () => prepared.map((p) => p.rec.x).join("");
  const save = () => {
    const blob = new Blob([shownText()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trace-${env}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const copy = () => void navigator.clipboard?.writeText(shownText());

  const driverNames = useMemo(() => {
    const all = new Set<string>(drivers);
    seenDrivers.current.forEach((d) => all.add(d));
    return [...all].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, seenDrivers.current.size, prepared.length]);
  const toggleChannel = (c: ChannelCode) => {
    const next = new Set(channels);
    if (next.has(c)) {
      next.delete(c);
    } else {
      next.add(c);
    }
    setChannels(next);
  };
  const toggleDriver = (d: string) => {
    const next = new Set(driverSel ?? []);
    const k = d.toLowerCase();
    if (next.has(k)) {
      next.delete(k);
    } else {
      next.add(k);
    }
    setDriverSel(next.size === 0 ? null : next);
  };
  const [showSettings, setShowSettings] = useState(false);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.target as HTMLElement).getAttribute("data-testid") === "trace-find") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
      return;
    }
    // [ and ] step between markers, Shift-] goes to the most recent, unless typing in a field
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    if (e.code === "BracketRight" || e.code === "BracketLeft") {
      e.preventDefault();
      jump(e.code === "BracketLeft" ? -1 : e.shiftKey ? 0 : 1);
    }
  };

  return (
    <div className="pad tracepane tv" onKeyDown={onKey} data-testid="trace-viewer">
      <div className="addrow">
        {servers && servers.length > 1 && (
          <label className="field">
            <em>Server</em>
            <select value={server} onChange={(e) => setServer(e.target.value)} disabled={running} title="Every server of the driver set keeps its own trace; blank streams them all" data-testid="trace-server">
              <option value="">all servers</option>
              {servers.map((s) => (
                <option key={s.dn} value={s.dn}>
                  {s.name}
                  {s.primary ? " (environment's)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {file ? (
          <>
            <span className="small" data-testid="trace-file">
              <strong>{file}</strong>
              {fileInfo && (
                <span className="muted">
                  {" "}
                  · {fileInfo.matched === fileInfo.total ? `${fileInfo.total} records` : `${fileInfo.matched} of ${fileInfo.total} records match`}
                  {fileInfo.matched > settings.bufferMax ? `, the first ${settings.bufferMax} loaded` : ""}
                </span>
              )}
            </span>
            <button onClick={loadFile} disabled={fileBusy} title="Read the file again">
              {fileBusy ? "Reading…" : "Reload"}
            </button>
          </>
        ) : (
          <>
            {running ? (
              <button onClick={() => (end(), setState("closed"))} data-testid="trace-stop">
                Stop
              </button>
            ) : (
              <button className="primary" onClick={start} data-testid="trace-start">
                Start
              </button>
            )}
            <label className="checkchip" title="Write every record of the stream, unfiltered, to a file the Trace files view lists; applies when the stream starts">
              <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} disabled={running} data-testid="trace-record" /> record to a file
            </label>
            {recording && (
              <span className="small muted" data-testid="trace-recording">
                recording {recording}
              </span>
            )}
            <button className={paused ? "on" : ""} onClick={() => setPaused(!paused)} title="Freeze the view; trace keeps being collected" data-testid="trace-pause">
              {paused ? "Resume" : "Pause"}
            </button>
            <button onClick={clear} title="Empty the buffer">
              Clear
            </button>
          </>
        )}
        <button onClick={save} disabled={prepared.length === 0} title="Download what is shown, filters applied">
          Save displayed…
        </button>
        <button onClick={copy} disabled={prepared.length === 0} title="Copy what is shown as plain text">
          Copy
        </button>
        <span className="spacer" />
        {!file && (
          <span className={state === "open" ? "live on" : "live off"} data-testid="trace-state">
            {state === "idle" ? "not started" : state}
          </span>
        )}
        <span className="muted small" data-testid="trace-counts">
          {prepared.length} shown of {buffer.current.length}
        </span>
        <button className={showSettings ? "on" : ""} onClick={() => setShowSettings(!showSettings)} title="View settings">
          ⚙
        </button>
        {!popout && (
          <button onClick={popOut} title="Open the trace in its own window" data-testid="trace-popout">
            Pop out ↗
          </button>
        )}
      </div>
      <div className="addrow tvfilters" data-testid="trace-filters">
        <span className="small muted">Channels</span>
        {CHANNELS.map((c) => (
          <label key={c.code} className={"checkchip" + (channels.has(c.code) ? " on" : "")} title={c.label}>
            <input type="checkbox" checked={channels.has(c.code)} onChange={() => toggleChannel(c.code)} /> {c.label}
          </label>
        ))}
        <span className="small muted">Drivers</span>
        <details className="tvdrivers">
          <summary data-testid="trace-drivers">{driverSel ? `${driverSel.size} of ${driverNames.length}` : "all"}</summary>
          <div className="tvdriverlist">
            {driverNames.map((d) => (
              <label key={d} className="checkchip">
                <input type="checkbox" checked={!driverSel || driverSel.has(d.toLowerCase())} onChange={() => toggleDriver(d)} /> {d}
              </label>
            ))}
            {driverSel && (
              <button className="mini" onClick={() => setDriverSel(null)}>
                all
              </button>
            )}
          </div>
        </details>
        <input className="outline-filter" style={{ width: 180 }} placeholder="contains…" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} title="Show only messages containing this" data-testid="trace-contains" />
        <input className="outline-filter" style={{ width: 180 }} placeholder="find…" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} title="Mark every match; Enter and Shift-Enter step through them" data-testid="trace-find" />
        {query && (
          <span className="small muted" data-testid="trace-find-count">
            {hitCount === 0 ? "no match" : `${Math.min(current + 1, hitCount)} of ${hitCount}`}
          </span>
        )}
        <button className="mini" disabled={hitCount === 0} onClick={() => step(-1)} title="Previous match (Shift-Enter)">
          ▲
        </button>
        <button className="mini" disabled={hitCount === 0} onClick={() => step(1)} title="Next match (Enter)">
          ▼
        </button>
        <label className="checkchip" title="Hide whitespace-only lines (XSLT policy trace pads its steps)">
          <input type="checkbox" checked={settings.compact} onChange={(e) => update({ compact: e.target.checked })} /> compact
        </label>
        <label className="checkchip" title="Scroll to the newest record as it arrives">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow
        </label>
      </div>
      <div className="addrow tvjump" data-testid="trace-jump">
        <span className="small muted">Jump to</span>
        <select value={jumpKind} onChange={(e) => setJumpKind(e.target.value)} title="The kind of place to jump to, by the engine's own message" data-testid="trace-jump-kind">
          {MARKERS.map((m) => (
            <option key={m.code} value={m.code}>
              {m.label}
            </option>
          ))}
        </select>
        <button className="mini" disabled={prepared.length === 0} onClick={() => jump(-1)} title="Previous ([)" data-testid="trace-jump-prev">
          ◀
        </button>
        <button className="mini" disabled={prepared.length === 0} onClick={() => jump(1)} title="Next (])" data-testid="trace-jump-next">
          ▶
        </button>
        <button className="mini" disabled={prepared.length === 0} onClick={() => jump(0)} title="The most recent (Shift-])" data-testid="trace-jump-last">
          most recent
        </button>
        <span className="small muted">Time</span>
        <input
          className="outline-filter"
          style={{ width: 110 }}
          placeholder="hh:mm:ss"
          value={timeText}
          onChange={(e) => setTimeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              goToTime();
            }
          }}
          spellCheck={false}
          title="A time of day; Enter goes to the first message at or after it, by the messages' own timestamps"
          data-testid="trace-time"
        />
        {jumpNote && (
          <span className="small muted" data-testid="trace-jump-note">
            {jumpNote}
          </span>
        )}
      </div>
      {showSettings && (
        <div className="addrow tvsettings" data-testid="trace-settings">
          <label className="field">
            <em>Timestamps</em>
            <select value={settings.ts} onChange={(e) => update({ ts: e.target.value as TimestampFormat })}>
              {TIMESTAMP_FORMATS.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="checkchip">
            <input type="checkbox" checked={settings.wrap} onChange={(e) => update({ wrap: e.target.checked })} /> wrap lines
          </label>
          <label className="field">
            <em>Font</em>
            <input type="number" min={9} max={24} value={settings.font} onChange={(e) => update({ font: Math.max(9, Math.min(24, Number(e.target.value) || 12)) })} style={{ width: 60 }} />
          </label>
          <label className="field">
            <em>Kept in memory</em>
            <input type="number" min={1000} max={500000} step={1000} value={settings.bufferMax} onChange={(e) => update({ bufferMax: Math.max(1000, Number(e.target.value) || 50000) })} style={{ width: 90 }} />
          </label>
          <label className="field">
            <em>Shown</em>
            <input type="number" min={500} max={100000} step={500} value={settings.shownMax} onChange={(e) => update({ shownMax: Math.max(500, Number(e.target.value) || 15000) })} style={{ width: 90 }} />
          </label>
          <span className="muted small">Memory keeps every driver unfiltered so a filter can look back; the view shows the newest.</span>
        </div>
      )}
      {failure && <div className="banner error">{failure}</div>}
      {streamErrors.length > 0 && <div className="banner error">{streamErrors.slice(-3).join(" · ")}</div>}
      <div className={"tvbox" + (settings.wrap ? " wrap" : "")} ref={box} onScroll={onScroll} tabIndex={0} style={{ fontSize: settings.font, lineHeight: `${lineHeight}px` }} data-testid="trace-lines">
        <div style={{ height: total, position: "relative" }}>
          {prepared.slice(first, last).map((p, i) => {
            const row = first + i;
            return (
              <div key={row} className={"tvrec" + (landed && shown[row] === landed ? " tvlanded" : "")} style={{ position: "absolute", top: offsets[row], left: 0, right: 0 }} data-driver={p.rec.d ?? ""} data-channel={p.rec.c}>
                {segments(p.rec.x, p.rec.r, hitRows.get(row) ?? []).map((s, j) => {
                  const link = linkFor(s);
                  return (
                    <span key={j} className={"tk-" + s.token + (s.ds >= 0 ? " ds-" + s.ds : "") + (s.hit ? " hit" : "") + (link ? " tvlink" : "")} onClick={link ?? undefined} title={link ? "Open in the tree" : undefined}>
                      {s.text}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
        {prepared.length === 0 && <div className="muted tvempty">{file ? (fileBusy ? "Reading the file…" : "Nothing in the file matches.") : state === "idle" ? "Start to stream the driver set's trace. Every driver's trace is kept; the filters choose what is shown." : "Nothing matches, or nothing has arrived yet."}</div>}
      </div>
    </div>
  );
}

/** The first index whose offset is greater than `v` (binary search over ascending offsets). */
function lowerBound(offsets: number[], v: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! <= v) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return Math.max(0, lo - 1);
}
