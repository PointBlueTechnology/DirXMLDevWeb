import { describe, expect, it } from "vitest";
import { cacheBytes } from "./drivers";

describe("cacheBytes", () => {
  it("gives the engine's cache size its unit", () => {
    expect(cacheBytes("465")).toBe("465 bytes");
    expect(cacheBytes(0)).toBe("0 bytes");
  });
  it("leaves what isn't a size alone", () => {
    expect(cacheBytes("?")).toBe("?");
    expect(cacheBytes(undefined)).toBe("");
    expect(cacheBytes("")).toBe("");
  });
});
