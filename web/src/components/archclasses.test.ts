import pageCss from "../styles.css?raw";
import { describe, expect, it } from "vitest";
import { ARCH_CSS, archLayout } from "./ArchitectureView";

/**
 * Every class in the Architecture picture carries the `arch-` prefix: the page's own stylesheet styles
 * plain names (`.app { height: 100% }` for the app shell), and under SVG 2 a CSS `height` overrides a
 * rectangle's attribute — every card was drawn the full picture's height before this.
 */
describe("Architecture picture classes", () => {
  const classesIn = (css: string) => new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1] ?? ""));

  it("prefixes every class it styles", () => {
    const unprefixed = [...classesIn(ARCH_CSS)].filter((c) => c !== "arch-svg" && !c.startsWith("arch-") && !["dim", "selected", "running", "stopped", "disabled", "other"].includes(c));
    expect(unprefixed).toEqual([]);
  });

  it("uses no class the page's stylesheet also styles", () => {
    const page = pageCss.replace(/\.arch-svg[^{]*\{[^}]*\}/g, "");
    const pageClasses = classesIn(page);
    const clash = [...classesIn(ARCH_CSS)].filter((c) => c.startsWith("arch-") && c !== "arch-svg" && pageClasses.has(c));
    expect(clash).toEqual([]);
  });

  it("still lays every driver out at one card height", () => {
    const apps = ["A", "B", "C"].map((n, i) => ({ driver: n, typeName: n, vaultOnly: i === 2 }) as never);
    const l = archLayout(apps);
    const ys = [...l.left, ...l.right].map((p) => p.y).sort((a, b) => a - b);
    expect(ys.length).toBe(3);
  });
});
