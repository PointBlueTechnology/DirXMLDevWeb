/** A component of a JSON form, flattened for the field list: where it sits and what it is. */
export interface FormField {
  key: string;
  type: string;
  label: string;
  required: boolean;
  hidden: boolean;
  depth: number;
  /** The key of the container this component sits in, or null at the top. */
  parent: string | null;
  /** True for a component that holds others (panel, columns, container …). */
  container: boolean;
  /** Its position among its siblings, and how many there are. */
  index: number;
  siblings: string[];
}

interface Component {
  key?: unknown;
  type?: unknown;
  label?: unknown;
  hidden?: unknown;
  validate?: { required?: unknown };
  components?: unknown;
  columns?: unknown;
  rows?: unknown;
}

function childLists(c: Component): Component[][] {
  const lists: Component[][] = [];
  if (Array.isArray(c.components)) {
    lists.push(c.components as Component[]);
  }
  if (Array.isArray(c.columns)) {
    for (const col of c.columns as Component[]) {
      if (col && Array.isArray(col.components)) {
        lists.push(col.components as Component[]);
      }
    }
  }
  if (Array.isArray(c.rows)) {
    for (const row of c.rows as unknown[]) {
      if (Array.isArray(row)) {
        for (const cell of row as Component[]) {
          if (cell && Array.isArray(cell.components)) {
            lists.push(cell.components as Component[]);
          }
        }
      }
    }
  }
  return lists;
}

/** Every component of the form document in display order; an unparseable document gives none. */
export function fieldsOf(json: string): { title: string; display: string; fields: FormField[]; error: string | null } {
  let doc: { title?: unknown; display?: unknown; components?: unknown };
  try {
    doc = JSON.parse(json) as typeof doc;
  } catch (e) {
    return { title: "", display: "", fields: [], error: e instanceof Error ? e.message : String(e) };
  }
  const fields: FormField[] = [];
  const walk = (list: Component[], depth: number, parent: string | null) => {
    const keyed = list.filter((c) => c && typeof c.key === "string");
    const siblings = keyed.map((c) => String(c.key));
    keyed.forEach((c, index) => {
      const lists = childLists(c);
      fields.push({
        key: String(c.key),
        type: typeof c.type === "string" ? c.type : "",
        label: typeof c.label === "string" ? c.label : "",
        required: c.validate?.required === true,
        hidden: c.hidden === true,
        depth,
        parent,
        container: lists.length > 0,
        index,
        siblings,
      });
      for (const l of lists) {
        walk(l, depth + 1, String(c.key));
      }
    });
  };
  if (Array.isArray(doc.components)) {
    walk(doc.components as Component[], 0, null);
  }
  return { title: typeof doc.title === "string" ? doc.title : "", display: typeof doc.display === "string" ? doc.display : "", fields, error: null };
}
