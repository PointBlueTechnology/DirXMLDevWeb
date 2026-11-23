import { describe, expect, it } from "vitest";
import { libraryAliasOf, libraryLabel, libraryTitle, otherLibraries, ownLibrary } from "./libraries";
import type { ArtifactNode, Outline } from "./types";

const node = (path: string, library?: string): ArtifactNode => ({ path, name: path.split("/").pop()!, kind: "dirxml-script", file: null, ...(library ? { library, readOnly: "cn=" + library + ",o=x" } : {}) });

const outline = {
  library: {
    policies: [node("library/lib-sub-command"), node("libraries/pub/lib-sub-command", "pub")],
    resources: [node("libraries/Library@services/es-misc", "Library@services")],
  },
  libraries: [
    { alias: "Library@services", dn: "cn=Library,ou=services,o=x", items: 1 },
    { alias: "links-only", dn: "cn=links-only,o=x", items: 0 },
    { alias: "pub", dn: "cn=pub,o=x", items: 1 },
  ],
} as unknown as Outline;

describe("Library folders (DirXMLDev 0.77.0)", () => {
  it("keeps the driver set's own Library apart from the others", () => {
    expect(ownLibrary(outline).policies.map((n) => n.path)).toEqual(["library/lib-sub-command"]);
    expect(ownLibrary(outline).resources).toEqual([]);
  });

  it("groups each other Library that holds objects, in the tree's order", () => {
    const groups = otherLibraries(outline);
    expect(groups.map((g) => g.alias)).toEqual(["Library@services", "pub"]);
    expect(groups[1]!.dn).toBe("cn=pub,o=x");
    expect(groups[1]!.policies.map((n) => n.path)).toEqual(["libraries/pub/lib-sub-command"]);
  });

  it("names the Library where two hold one name", () => {
    expect(libraryLabel(node("library/lib-sub-command"))).toBe("Library: lib-sub-command");
    expect(libraryLabel(node("libraries/pub/lib-sub-command", "pub"))).toBe("Library pub: lib-sub-command");
    expect(libraryLabel(node("libraries/Library@services/x", "Library@services"))).toBe("Library@services: x");
    expect(libraryTitle("Library~2")).toBe("Library~2");
    expect(libraryTitle("LibraryTools")).toBe("Library LibraryTools");
    expect(libraryLabel(node("drivers/AD/subscriber/sub-ctp"))).toBe("sub-ctp");
  });

  it("reads the alias from a path", () => {
    expect(libraryAliasOf("libraries/pub/x")).toBe("pub");
    expect(libraryAliasOf("library/x")).toBeNull();
  });

  it("treats an outline from an older server as having one Library", () => {
    const old = { library: { policies: [node("library/a")], resources: [] } } as unknown as Outline;
    expect(otherLibraries(old)).toEqual([]);
    expect(ownLibrary(old).policies).toHaveLength(1);
  });
});
