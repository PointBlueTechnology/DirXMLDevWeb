/**
 * The page's side of the trace viewer: what the server sends (a parsed, highlighted record from
 * the DirXML Trace Viewer's library) and the pure functions the view applies to it — timestamp
 * format, compact whitespace, filters, find, and the split of a record's text into render segments.
 */

/** A record as `TraceService.json` writes it. `h` = [tsStart, tsEnd, nameStart, nameEnd, threadStart, threadEnd, end, stamped]. */
export interface TraceRec {
  s: string;
  t: number;
  d: string | null;
  c: "S" | "P" | "V" | "O";
  h: number[] | null;
  x: string;
  r: [number, number, string, number][];
  /** The jump marker (`TraceMarker` in the trace library) this record is, if any. */
  k?: string | null;
  /** The header's time of day in milliseconds, -1 without a header. */
  tm?: number;
}

/** The kinds of place to jump to (#2 of the trace viewer), as the library's `TraceMarker` names them. */
export const MARKERS: { code: string; label: string }[] = [
  { code: "DRIVER_START", label: "Driver start" },
  { code: "PUBLISHER_EVENT", label: "Publisher event" },
  { code: "SUBSCRIBER_EVENT", label: "Subscriber event" },
  { code: "SUBSCRIBER_EXECUTE", label: "Subscriber shim" },
  { code: "POLICY", label: "Policy" },
  { code: "POLICY_SET", label: "Policy set" },
  { code: "END_TRANSACTION", label: "End transaction" },
  { code: "LOG_EVENT", label: "Log event" },
  { code: "PUMP_XDS", label: "Pump to eDirectory" },
];

/**
 * The row of the next (`dir` 1) or previous (-1) record of `kind` after or before row `base`, or
 * the most recent one (0); -1 when there is none.
 */
export function markerRow(recs: TraceRec[], kind: string, base: number, dir: 1 | -1 | 0): number {
  if (dir === 1) {
    for (let i = Math.max(0, base + 1); i < recs.length; i++) {
      if (recs[i]!.k === kind) {
        return i;
      }
    }
    return -1;
  }
  for (let i = dir === 0 ? recs.length - 1 : Math.min(recs.length, base) - 1; i >= 0; i--) {
    if (recs[i]!.k === kind) {
      return i;
    }
  }
  return -1;
}

/** Milliseconds since midnight in `s` (`10:15`, `10:15:12`, `10:15:12.345`), or -1. */
export function parseTimeOfDay(s: string): number {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?/.exec(s);
  if (!m) {
    return -1;
  }
  const [hh, mm, ss] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0];
  const ms = m[4] ? Number((m[4] + "00").slice(0, 3)) : 0;
  return hh < 24 && mm < 60 && ss < 60 ? ((hh * 60 + mm) * 60 + ss) * 1000 + ms : -1;
}

/** The first row at or after `ms` (a record without a header takes its predecessor's time), or -1. */
export function rowAtTime(recs: TraceRec[], ms: number): number {
  let last = -1;
  for (let i = 0; i < recs.length; i++) {
    const t = recs[i]!.tm ?? -1;
    last = t >= 0 ? t : last;
    if (last >= ms) {
      return i;
    }
  }
  return -1;
}

export type ChannelCode = TraceRec["c"];
export const CHANNELS: { code: ChannelCode; label: string }[] = [
  { code: "S", label: "Subscriber" },
  { code: "P", label: "Publisher" },
  { code: "V", label: "Service" },
  { code: "O", label: "Engine / Other" },
];

export type TimestampFormat = "US" | "EUROPEAN" | "EUROPEAN_SLASH" | "ISO" | "TIME_ONLY";
export const TIMESTAMP_FORMATS: { name: TimestampFormat; label: string }[] = [
  { name: "US", label: "U.S." },
  { name: "EUROPEAN", label: "European" },
  { name: "EUROPEAN_SLASH", label: "European (slashes)" },
  { name: "ISO", label: "ISO 8601" },
  { name: "TIME_ONLY", label: "Time only" },
];

const p2 = (n: number) => String(n).padStart(2, "0");
const p3 = (n: number) => String(n).padStart(3, "0");

/** The same patterns as the desktop viewer's TimestampFormat, in local time. */
export function formatTimestamp(ms: number, f: TimestampFormat): string {
  const d = new Date(ms);
  const time = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`;
  const yy = p2(d.getFullYear() % 100);
  const MM = p2(d.getMonth() + 1);
  const dd = p2(d.getDate());
  switch (f) {
    case "US":
      return `${MM}/${dd}/${yy} ${time}`;
    case "EUROPEAN":
      return `${dd}.${MM}.${yy} ${time}`;
    case "EUROPEAN_SLASH":
      return `${dd}/${MM}/${yy} ${time}`;
    case "ISO":
      return `${d.getFullYear()}-${MM}-${dd} ${time}`;
    case "TIME_ONLY":
      return time;
  }
}

/** The record with a viewer-added timestamp rewritten in `f`; unchanged when the stamp came with the text. */
export function withTimestamp(rec: TraceRec, f: TimestampFormat): TraceRec {
  const h = rec.h;
  if (!h || h[7] !== 1) {
    return rec;
  }
  const from = h[0]! + 1;
  const to = h[1]! - 1;
  const stamp = formatTimestamp(rec.t, f);
  if (rec.x.slice(from, to) === stamp) {
    return rec;
  }
  const shift = stamp.length - (to - from);
  const mv = (p: number) => (p >= to ? p + shift : p);
  return {
    ...rec,
    x: rec.x.slice(0, from) + stamp + rec.x.slice(to),
    r: rec.r.map(([a, b, tk, ds]) => [mv(a), mv(b), tk, ds]),
    h: [h[0]!, h[1]! + shift, h[2]! + shift, h[3]! + shift, h[4]! < 0 ? -1 : h[4]! + shift, h[5]! < 0 ? -1 : h[5]! + shift, h[6]! + shift, 1],
  };
}

/** The record without its whitespace-only lines; runs and header positions remapped. */
export function compact(rec: TraceRec): TraceRec {
  const removed: [number, number][] = [];
  let pos = 0;
  for (const line of rec.x.split("\n")) {
    const end = pos + line.length + 1;
    if (line.trim() === "" && pos > 0 && end <= rec.x.length) {
      removed.push([pos, end]);
    }
    pos = end;
  }
  if (removed.length === 0) {
    return rec;
  }
  const map = (p: number) => {
    let out = p;
    for (const [a, b] of removed) {
      if (p >= b) {
        out -= b - a;
      } else if (p > a) {
        out -= p - a;
        break;
      } else {
        break;
      }
    }
    return out;
  };
  let x = "";
  let last = 0;
  for (const [a, b] of removed) {
    x += rec.x.slice(last, a);
    last = b;
  }
  x += rec.x.slice(last);
  const r = rec.r.map(([a, b, tk, ds]) => [map(a), map(b), tk, ds] as [number, number, string, number]).filter(([a, b]) => b > a);
  const h = rec.h ? rec.h.map((v, i) => (i === 7 || v < 0 ? v : map(v))) : null;
  return { ...rec, x, r, h };
}

export interface Filter {
  channels: Set<ChannelCode>;
  /** lower-cased driver names, or null for every driver */
  drivers: Set<string> | null;
  text: string;
}

export const ALL: Filter = { channels: new Set<ChannelCode>(["S", "P", "V", "O"]), drivers: null, text: "" };

export function matches(f: Filter, rec: TraceRec): boolean {
  if (!f.channels.has(rec.c)) {
    return false;
  }
  if (f.drivers && (rec.d === null || !f.drivers.has(rec.d.toLowerCase()))) {
    return false;
  }
  if (f.text && !rec.x.toLowerCase().includes(f.text.toLowerCase())) {
    return false;
  }
  return true;
}

/** Every occurrence of `q` in `text`, case-insensitive, as [start, end). */
export function findRanges(text: string, q: string): [number, number][] {
  if (!q) {
    return [];
  }
  const out: [number, number][] = [];
  const hay = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = hay.indexOf(needle);
  while (i >= 0) {
    out.push([i, i + needle.length]);
    i = hay.indexOf(needle, i + needle.length);
  }
  return out;
}

export interface Segment {
  text: string;
  token: string;
  ds: number;
  hit: boolean;
}

/**
 * The text cut at every run and find boundary. Runs may overlap (the highlighter layers them,
 * lowest priority first): the last run covering a segment wins, as in the desktop viewer.
 */
export function segments(text: string, runs: TraceRec["r"], hits: [number, number][]): Segment[] {
  const cuts = new Set<number>([0, text.length]);
  for (const [a, b] of runs) {
    cuts.add(a);
    cuts.add(b);
  }
  for (const [a, b] of hits) {
    cuts.add(a);
    cuts.add(b);
  }
  const points = [...cuts].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (b <= a) {
      continue;
    }
    let token = "TEXT";
    let ds = -1;
    for (const [ra, rb, tk, d] of runs) {
      if (ra <= a && rb >= b) {
        token = tk;
        ds = d;
      }
    }
    const hit = hits.some(([ha, hb]) => ha <= a && hb >= b);
    out.push({ text: text.slice(a, b), token, ds, hit });
  }
  return out;
}

/** Lines a record takes on screen without wrapping (its text always ends with a newline). */
export function lineCount(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      n++;
    }
  }
  return Math.max(1, text.endsWith("\n") ? n : n + 1);
}
