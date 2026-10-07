import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, followTrace, tokenForLink } from "../api";
import { ALL, CHANNELS, TIMESTAMP_FORMATS, compact as compactRec, findRanges, lineCount, matches, segments, withTimestamp, type ChannelCode, type Filter, type TimestampFormat, type TraceRec } from "../trace/model";

interface Props {
  env: string;
  /** the tree's driver names, offered in the driver filter before any trace arrives */
  drivers: string[];
  /** rendered alone in its own window: no pop-out button */
  popout?: boolean;
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
export function TraceViewer({ env, drivers, popout }: Props) {
  const popOut = () => {
    const tok = tokenForLink();
    const url = `${window.location.pathname}${window.location.search}#type=trace&env=${encodeURIComponent(env)}${tok ? `&token=${tok}` : ""}`;
    window.open(url, "_blank", "popup=yes,width=1280,height=860");
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
    api.vault
      .servers(env)
      .then((r) => setServers(r.servers))
      .catch(() => setServers([]));
  }, [env]);

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
    end();
    setFailure(null);
    setStreamErrors([]);
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
          setFailure(s.failed);
          setState("closed");
        } else {
          setState(s);
        }
      },
      server || undefined,
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
    }
  };
  const first = Math.max(0, lowerBound(offsets, view.top) - 1);
  const last = Math.min(prepared.length, lowerBound(offsets, view.top + view.height) + 1);

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
        {running ? (
          <button onClick={() => (end(), setState("closed"))} data-testid="trace-stop">
            Stop
          </button>
        ) : (
          <button className="primary" onClick={start} data-testid="trace-start">
            Start
          </button>
        )}
        <button className={paused ? "on" : ""} onClick={() => setPaused(!paused)} title="Freeze the view; trace keeps being collected" data-testid="trace-pause">
          {paused ? "Resume" : "Pause"}
        </button>
        <button onClick={clear} title="Empty the buffer">
          Clear
        </button>
        <button onClick={save} disabled={prepared.length === 0} title="Download what is shown, filters applied">
          Save displayed…
        </button>
        <button onClick={copy} disabled={prepared.length === 0} title="Copy what is shown as plain text">
          Copy
        </button>
        <span className="spacer" />
        <span className={state === "open" ? "live on" : "live off"} data-testid="trace-state">
          {state === "idle" ? "not started" : state}
        </span>
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
      <div className={"tvbox" + (settings.wrap ? " wrap" : "")} ref={box} onScroll={onScroll} style={{ fontSize: settings.font, lineHeight: `${lineHeight}px` }} data-testid="trace-lines">
        <div style={{ height: total, position: "relative" }}>
          {prepared.slice(first, last).map((p, i) => {
            const row = first + i;
            return (
              <div key={row} className="tvrec" style={{ position: "absolute", top: offsets[row], left: 0, right: 0 }} data-driver={p.rec.d ?? ""} data-channel={p.rec.c}>
                {segments(p.rec.x, p.rec.r, hitRows.get(row) ?? []).map((s, j) => (
                  <span key={j} className={"tk-" + s.token + (s.ds >= 0 ? " ds-" + s.ds : "") + (s.hit ? " hit" : "")}>
                    {s.text}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
        {prepared.length === 0 && <div className="muted tvempty">{state === "idle" ? "Start to stream the driver set's trace. Every driver's trace is kept; the filters choose what is shown." : "Nothing matches, or nothing has arrived yet."}</div>}
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
