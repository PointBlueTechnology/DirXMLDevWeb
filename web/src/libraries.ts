// Library objects by the Library they live in (DirXMLDev 0.77.0, docs/library-containers.md): the
// driver set's own Library is library/; each other Library or container the set uses has a folder
// of its own, libraries/<alias>/, read-only here.
import type { ArtifactNode, Outline } from "./types";

export interface LibraryGroup {
  /** null for the driver set's own Library. */
  alias: string | null;
  /** The other Library's DN; null for the driver set's own. */
  dn: string | null;
  policies: ArtifactNode[];
  resources: ArtifactNode[];
}

/** The driver set's own Library: the objects without an alias. */
export function ownLibrary(o: Outline): { policies: ArtifactNode[]; resources: ArtifactNode[] } {
  return { policies: o.library.policies.filter((n) => !n.library), resources: o.library.resources.filter((n) => !n.library) };
}

/** Each other Library that holds objects, in the order the tree lists them. */
export function otherLibraries(o: Outline): LibraryGroup[] {
  const out: LibraryGroup[] = [];
  for (const l of o.libraries ?? []) {
    const policies = o.library.policies.filter((n) => n.library === l.alias);
    const resources = o.library.resources.filter((n) => n.library === l.alias);
    if (policies.length + resources.length > 0) {
      out.push({ alias: l.alias, dn: l.dn, policies, resources });
    }
  }
  return out;
}

/** How another Library reads: its alias, "Library" first unless the alias says it (Library@services, Library pub). */
export function libraryTitle(alias: string): string {
  return /^library(@|$|~)/i.test(alias) ? alias : `Library ${alias}`;
}

/** How a Library object reads where it's picked beside a driver's own: "Library: x", "Library pub: x", "Library@services: x". */
export function libraryLabel(a: ArtifactNode): string {
  if (a.library) {
    return `${libraryTitle(a.library)}: ${a.name}`;
  }
  return a.path.startsWith("library/") ? `Library: ${a.name}` : a.name;
}

/** The alias of a path under libraries/, or null. */
export function libraryAliasOf(path: string): string | null {
  const parts = path.split("/");
  return parts[0] === "libraries" && parts.length >= 2 ? parts[1]! : null;
}
