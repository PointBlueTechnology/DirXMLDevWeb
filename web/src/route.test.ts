import { describe, expect, it } from "vitest";
import { fromHash, toHash } from "./route";
import type { Selection } from "./types";

describe("the selection in the address", () => {
  it("round-trips every kind of selection", () => {
    const all: Selection[] = [
      { type: "home" },
      { type: "flow", driver: "Active Directory Driver" },
      { type: "artifact", path: "drivers/AD/sub-ctp-X" },
      { type: "file", file: "driverset.xml" },
      { type: "config", driver: null },
      { type: "config", driver: "Loop" },
      { type: "prd", driver: "UA", name: "Request Access" },
      { type: "entitlement", driver: "Loop", name: "G&M", file: "drivers/Loop/entitlements/G&M.xml" },
      { type: "connections", env: "stg" },
      { type: "changes", against: "base" },
      { type: "new", what: "policy", driver: null },
      { type: "driverset" },
      { type: "driverset", tab: "schema" },
      { type: "trace", env: "edir3" },
    ];
    for (const s of all) {
      expect(fromHash(toHash(s))).toEqual(s);
    }
  });

  it("ignores the token fragment and nonsense", () => {
    expect(fromHash("#token=abc")).toBeNull();
    expect(fromHash("")).toBeNull();
    expect(fromHash("#type=flow")).toBeNull();
    expect(fromHash("#type=nope")).toBeNull();
  });
});
