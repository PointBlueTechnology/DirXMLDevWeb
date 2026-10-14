import { describe, expect, it } from "vitest";
import { ALL, compact, findRanges, formatTimestamp, lineCount, markerRow, matches, parseTimeOfDay, rowAtTime, segments, withTimestamp, type TraceRec } from "./model";

const rec = (x: string, extra: Partial<TraceRec> = {}): TraceRec => ({ s: "idm1", t: 0, d: "AD", c: "S", h: null, x, r: [], ...extra });

describe("timestamps", () => {
  it("rewrites a viewer-added stamp and shifts what follows", () => {
    const t = Date.UTC(2026, 8, 28, 14, 5, 12, 345);
    const us = formatTimestamp(t, "US");
    const text = `[${us}]:AD ST:hello\n`;
    const r = rec(text, { t, h: [0, us.length + 2, us.length + 3, us.length + 5, us.length + 6, us.length + 8, us.length + 9, 1], r: [[us.length + 3, us.length + 5, "DRIVER", -1]] });
    const iso = withTimestamp(r, "ISO");
    expect(iso.x).toBe(`[${formatTimestamp(t, "ISO")}]:AD ST:hello\n`);
    expect(iso.x.slice(iso.r[0]![0], iso.r[0]![1])).toBe("AD");
    expect(iso.h![7]).toBe(1);
    // a stamp that came with the text stays
    expect(withTimestamp(rec(text, { h: [0, 5, 6, 8, 9, 11, 12, 0] }), "ISO").x).toBe(text);
  });
});

describe("compact", () => {
  it("drops blank lines and remaps runs and the header", () => {
    // "<b/>" sits at 12–16 of the original; the run at 8–10 covers only the removed blank lines
    const r = rec("AD ST:a\n\n\n  <b/>\n", { h: [0, 0, 0, 2, 3, 5, 6, 0], r: [[0, 2, "DRIVER", -1], [12, 16, "XML_TAG", -1], [8, 10, "TEXT", -1]] });
    const c = compact(r);
    expect(c.x).toBe("AD ST:a\n  <b/>\n");
    expect(c.x.slice(c.r[0]![0], c.r[0]![1])).toBe("AD");
    const xml = c.r.find(([, , tk]) => tk === "XML_TAG")!;
    expect(c.x.slice(xml[0], xml[1])).toBe("<b/>");
    expect(c.r.some(([, , tk]) => tk === "TEXT")).toBe(false);
    expect(compact(rec("one line\n"))).toEqual(rec("one line\n"));
  });
});

describe("filters", () => {
  it("match by channel, driver and text", () => {
    const r = rec("AD ST:Applying policy\n");
    expect(matches(ALL, r)).toBe(true);
    expect(matches({ ...ALL, channels: new Set(["P"]) }, r)).toBe(false);
    expect(matches({ ...ALL, drivers: new Set(["ad"]) }, r)).toBe(true);
    expect(matches({ ...ALL, drivers: new Set(["loop"]) }, r)).toBe(false);
    expect(matches({ ...ALL, drivers: new Set(["ad"]) }, rec("engine\n", { d: null, c: "O" }))).toBe(false);
    expect(matches({ ...ALL, text: "POLICY" }, r)).toBe(true);
    expect(matches({ ...ALL, text: "nope" }, r)).toBe(false);
  });
});

describe("find and segments", () => {
  it("finds every occurrence and cuts the text at run and hit boundaries", () => {
    const text = "<status level=\"error\">bad error</status>\n";
    expect(findRanges(text, "ERROR")).toEqual([
      [15, 20],
      [26, 31],
    ]);
    const segs = segments(text, [[0, 7, "XML_TAG", -1], [0, 41, "STATUS_ERROR", -1]], findRanges(text, "error"));
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.find((s) => s.text === "error")?.hit).toBe(true);
    // the later run wins where two cover a segment
    expect(segs[0]!.token).toBe("STATUS_ERROR");
    expect(segs.every((s) => s.text.length > 0)).toBe(true);
  });
  it("counts lines", () => {
    expect(lineCount("a\n")).toBe(1);
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a")).toBe(1);
  });
});

describe("jump markers (#2 of the trace viewer)", () => {
  const rec = (k: string | null, tm: number): TraceRec => ({ s: "", t: 0, d: "AD", c: "S", h: null, x: "x\n", r: [], k, tm });
  const recs = [rec("SUBSCRIBER_EVENT", 1000), rec("POLICY", 2000), rec(null, -1), rec("POLICY", 5000), rec("END_TRANSACTION", 6000)];

  it("steps to the next and previous of a kind, and the most recent", () => {
    expect(markerRow(recs, "POLICY", 0, 1)).toBe(1);
    expect(markerRow(recs, "POLICY", 1, 1)).toBe(3);
    expect(markerRow(recs, "POLICY", 3, 1)).toBe(-1);
    expect(markerRow(recs, "POLICY", 3, -1)).toBe(1);
    expect(markerRow(recs, "POLICY", 1, -1)).toBe(-1);
    expect(markerRow(recs, "POLICY", 0, 0)).toBe(3);
    expect(markerRow(recs, "DRIVER_START", 0, 0)).toBe(-1);
  });

  it("goes to the first record at or after a time, a continuation taking its predecessor's", () => {
    expect(rowAtTime(recs, 1500)).toBe(1);
    expect(rowAtTime(recs, 2000)).toBe(1);
    expect(rowAtTime(recs, 4000)).toBe(3);
    expect(rowAtTime(recs, 7000)).toBe(-1);
  });

  it("reads a time of day", () => {
    expect(parseTimeOfDay("10:15")).toBe((10 * 60 + 15) * 60000);
    expect(parseTimeOfDay(" 09:05:07.5 ")).toBe(((9 * 60 + 5) * 60 + 7) * 1000 + 500);
    expect(parseTimeOfDay("25:00")).toBe(-1);
    expect(parseTimeOfDay("soon")).toBe(-1);
  });
});
