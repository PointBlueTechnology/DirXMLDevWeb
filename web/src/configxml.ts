// The configuration documents the W1 editors read, parsed for display. Reading only: every
// change goes back to the core as an operation, never as XML rewritten in the page.

function parse(xml: string): Element | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.querySelector("parsererror") ? null : doc.documentElement;
}

function kids(e: Element, name: string): Element[] {
  return Array.from(e.children).filter((c) => c.tagName === name);
}

// ---- driver filter ----

export interface FilterAttr {
  name: string;
  publisher: string;
  subscriber: string;
  mergeAuthority: string;
}

export interface FilterClass {
  name: string;
  publisher: string;
  subscriber: string;
  attrs: FilterAttr[];
}

export const CHANNEL_MODES = ["sync", "notify", "ignore", "reset"] as const;
export const MERGE_AUTHORITIES = ["default", "edir", "app", "none"] as const;

export function parseFilter(xml: string): FilterClass[] | null {
  const root = parse(xml);
  if (!root || root.tagName !== "filter") {
    return null;
  }
  return kids(root, "filter-class").map((c) => ({
    name: c.getAttribute("class-name") ?? "",
    publisher: c.getAttribute("publisher") ?? "ignore",
    subscriber: c.getAttribute("subscriber") ?? "ignore",
    attrs: kids(c, "filter-attr").map((a) => ({
      name: a.getAttribute("attr-name") ?? "",
      publisher: a.getAttribute("publisher") ?? "ignore",
      subscriber: a.getAttribute("subscriber") ?? "ignore",
      mergeAuthority: a.getAttribute("merge-authority") ?? "default",
    })),
  }));
}

// ---- schema map ----

export interface MapAttr {
  nds: string;
  app: string;
}

export interface MapClass extends MapAttr {
  attrs: MapAttr[];
}

export interface SchemaMap {
  classes: MapClass[];
  /** Attribute mappings outside any class. */
  attrs: MapAttr[];
}

function names(e: Element): MapAttr {
  return { nds: kids(e, "nds-name")[0]?.textContent ?? "", app: kids(e, "app-name")[0]?.textContent ?? "" };
}

export function parseSchemaMap(xml: string): SchemaMap | null {
  const root = parse(xml);
  if (!root || root.tagName !== "attr-name-map") {
    return null;
  }
  return {
    classes: kids(root, "class-name").map((c) => ({ ...names(c), attrs: kids(c, "attr-name").map(names) })),
    attrs: kids(root, "attr-name").map(names),
  };
}

// ---- mapping table ----

export interface MappingTable {
  columns: { name: string; type: string }[];
  rows: string[][];
}

export function parseMappingTable(xml: string): MappingTable | null {
  const root = parse(xml);
  if (!root || root.tagName !== "mapping-table") {
    return null;
  }
  const columns = kids(root, "col-def").map((c) => ({ name: c.getAttribute("name") ?? "", type: c.getAttribute("type") ?? "nocase" }));
  const rows = kids(root, "row").map((r) => {
    const cells = kids(r, "col").map((c) => c.textContent ?? "");
    while (cells.length < columns.length) {
      cells.push("");
    }
    return cells;
  });
  return { columns, rows };
}
