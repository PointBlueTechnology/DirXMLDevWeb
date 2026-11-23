import { describe, expect, it } from "vitest";
import { findingText, moduleOf } from "./components/ValidationPanel";

describe("moduleOf: the module a finding is grouped under", () => {
  it("names the driver for anything under drivers/", () => {
    expect(moduleOf("drivers/Active Directory Driver/NOVLADDCFG-itp-FormatConversions")).toEqual({ module: "Active Directory Driver", rest: "NOVLADDCFG-itp-FormatConversions", order: 2 });
    expect(moduleOf("drivers/User Application Driver/provisioning/prds/FourStepParallelApproval")).toEqual({ module: "User Application Driver", rest: "provisioning/prds/FourStepParallelApproval", order: 2 });
    expect(moduleOf("drivers/AD/driver-filter.xml").module).toBe("AD");
  });
  it("puts Library artifacts under Library and set-level things under the driver set", () => {
    expect(moduleOf("library/lib-Common")).toEqual({ module: "Library", rest: "lib-Common", order: 1 });
    expect(moduleOf("driverset")).toEqual({ module: "Driver set", rest: "", order: 0 });
    expect(moduleOf("config-values.xml")).toEqual({ module: "Driver set", rest: "config-values.xml", order: 0 });
  });
  it("orders driver set, Library, drivers", () => {
    expect([moduleOf("drivers/Z/x"), moduleOf("library/y"), moduleOf("driverset")].map((m) => m.order)).toEqual([2, 1, 0]);
  });
});

describe("findingText: a finding as text for the clipboard (#197)", () => {
  it("reads like idm validate's line, with the detail under it", () => {
    expect(findingText({ severity: "ERROR", code: "mapping-table-column", path: "drivers/AD/subscriber/maps", message: "<token-map> names column 'x'" })).toBe(
      "ERROR mapping-table-column drivers/AD/subscriber/maps: <token-map> names column 'x'",
    );
    expect(findingText({ severity: "warning", code: "c", path: "library/L", message: "m", detail: "more" })).toBe("WARNING c library/L: m\n  more");
  });
});
