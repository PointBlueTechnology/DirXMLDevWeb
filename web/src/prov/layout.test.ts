import { describe, expect, it } from "vitest";
import { layout } from "./layout";

describe("workflow layout", () => {
  it("puts each activity in the column after its furthest predecessor", () => {
    const l = layout(
      ["Start", "Approval", "Log", "Finish"],
      [
        { from: "Start", to: "Approval" },
        { from: "Approval", to: "Log" },
        { from: "Log", to: "Finish" },
        { from: "Approval", to: "Finish" },
      ],
      "Start",
    );
    expect([l.nodes.Start!.layer, l.nodes.Approval!.layer, l.nodes.Log!.layer, l.nodes.Finish!.layer]).toEqual([0, 1, 2, 3]);
    expect(l.back.size).toBe(0);
  });

  it("stacks the legs of a branch in one column", () => {
    const l = layout(
      ["Start", "Branch", "A", "B", "Merge", "Finish"],
      [
        { from: "Start", to: "Branch" },
        { from: "Branch", to: "A" },
        { from: "Branch", to: "B" },
        { from: "A", to: "Merge" },
        { from: "B", to: "Merge" },
        { from: "Merge", to: "Finish" },
      ],
      "Start",
    );
    expect(l.nodes.A!.layer).toBe(2);
    expect(l.nodes.B!.layer).toBe(2);
    expect(l.nodes.A!.y).not.toBe(l.nodes.B!.y);
    expect(l.nodes.Merge!.layer).toBe(3);
  });

  it("keeps a loop from pushing activities to the right for ever", () => {
    const l = layout(
      ["Start", "Check", "Fix", "Finish"],
      [
        { from: "Start", to: "Check" },
        { from: "Check", to: "Fix" },
        { from: "Fix", to: "Check" },
        { from: "Check", to: "Finish" },
      ],
      "Start",
    );
    expect(l.back.has("Fix>Check")).toBe(true);
    expect(l.nodes.Check!.layer).toBe(1);
    expect(l.nodes.Fix!.layer).toBe(2);
  });

  it("places an activity nothing links to, and ignores links to unknown ids", () => {
    const l = layout(["Start", "Orphan"], [{ from: "Start", to: "Gone" }], "Start");
    expect(Object.keys(l.nodes).sort()).toEqual(["Orphan", "Start"]);
    expect(l.width).toBeGreaterThan(0);
  });
});
