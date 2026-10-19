import { describe, expect, it } from "vitest";
import { ALL, compact, displayed, findRanges, foldPlan, formatTimestamp, ingest, lineCount, markerRow, MARKERS, matches, parseTimeOfDay, rowAtTime, segments, withTimestamp, type TraceRec } from "./model";

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

describe("folding (#3 of the trace viewer)", () => {
  const r = (x: string, extra: Partial<TraceRec> = {}): TraceRec => ({ s: "", t: 0, d: "AD", c: "S", h: null, x, r: [], ...extra });
  // a set (0) holding a policy (1) whose returned document is an XML region (2), as a live stream sends them
  const raw = [
    r("set\n", { fo: [[0, "POLICY_SET", -1, "Applying event transformation policies."]] }),
    r("policy\n", { fo: [[1, "POLICY", 0, "one"]], fw: 0 }),
    r("rule\n", { fw: 1 }),
    r("Policy returned:\n", { fw: 1 }),
    r("<nds>\n", { fo: [[2, "XML", 1, "<nds>"]], fw: 1 }),
    r("  <input/>\n</nds>\n", { fw: 2 }),
    r("End transaction.\n"),
  ];
  const recs = raw.map((x, i) => ingest(x, "s1", i));

  it("prefixes region ids with the stream, so two streams never share one", () => {
    expect(recs[1]!.fo![0]).toEqual(["s1:1", "POLICY", "s1:0", "one"]);
    expect(recs[0]!.fo![0]![2]).toBe(-1);
    expect(recs[2]!.fw).toBe("s1:1");
    expect(recs[6]!.fw).toBeUndefined();
    expect(recs[3]!.u).toBe(3);
  });

  it("hides what a collapsed region holds, keeping its first line, and counts it", () => {
    const open = foldPlan(recs, new Set());
    expect(open.hidden.every((h) => !h)).toBe(true);
    const set = open.regions.get("s1:0")!;
    expect([set.members, set.lines, set.policies]).toEqual([5, 6, 1]);
    expect(open.regions.get("s1:2")!.members).toBe(1);

    expect(foldPlan(recs, new Set(["s1:0"])).hidden).toEqual([false, true, true, true, true, true, false]);
    expect(foldPlan(recs, new Set(["s1:1"])).hidden).toEqual([false, false, true, true, true, true, false]);
    expect(foldPlan(recs, new Set(["s1:2"])).hidden).toEqual([false, false, false, false, false, true, false]);
  });

  it("ignores a region whose first line is not shown (filtered out or dropped)", () => {
    const withoutOpener = recs.slice(1);
    const p = foldPlan(withoutOpener, new Set(["s1:0"]));
    expect(p.regions.has("s1:0")).toBe(false);
    expect(p.hidden.every((h) => !h)).toBe(true);
  });

  it("folds an XML document inside a record to its first line, runs remapped, and places its toggle", () => {
    const x = "head:\n<nds>\n  <input/>\n</nds>\n\ntail\n";
    const rec = r(x, { fx: [[1, 3]], r: [[x.indexOf("tail"), x.indexOf("tail") + 4, "STATUS_ERROR", -1]] });
    const shut = displayed(rec, new Set([0]), false);
    expect(shut.rec.x).toBe("head:\n<nds>\n\ntail\n");
    expect(shut.starts).toEqual([1]);
    const [a, b, tk] = shut.rec.r[0]!;
    expect([shut.rec.x.slice(a, b), tk]).toEqual(["tail", "STATUS_ERROR"]);
    expect(displayed(rec, new Set([0]), true).rec.x).toBe("head:\n<nds>\ntail\n");
    expect(displayed(rec, new Set(), true).rec.x).toBe(compact(rec).x);
    expect(displayed(r("a\n\n<x>\n<y/>\n</x>\n", { fx: [[2, 4]] }), new Set(), true).starts).toEqual([1]);
  });
});

describe("MARKERS", () => {
  it("offers trace-core 1.8.0's policy result as a jump", () => {
    expect(MARKERS.map((m) => m.code)).toContain("POLICY_RESULT");
  });
});
