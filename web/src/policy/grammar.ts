// The DirXML Script grammar the structured editor is driven by: for each element, its attributes,
// the children it may hold and whether it holds text. Generated from the DTD Designer ships by
// tools/dtd2grammar.py; nothing here is hand-maintained, so the editor covers the whole language.
import raw from "./grammar.json";

export interface AttrSpec {
  name: string;
  required: boolean;
  /** An enumerated attribute's values; absent for free text. */
  values?: string[];
  default: string | null;
}

export type GroupName = "conditions" | "actions" | "tokens";

export interface ChildSpec {
  /** One element name, or … */
  name?: string;
  /** … every member of a group. */
  group?: GroupName;
  min: number;
  /** null = any number. */
  max: number | null;
}

export interface ElementSpec {
  attrs: AttrSpec[];
  children: ChildSpec[];
  text: boolean;
}

interface Grammar {
  version: string;
  groups: Record<GroupName, string[]>;
  elements: Record<string, ElementSpec>;
}

export const grammar = raw as unknown as Grammar;

const NONE: ElementSpec = { attrs: [], children: [], text: true };

/** The spec of an element; an element the grammar does not know is treated as free-form. */
export function spec(tag: string): ElementSpec {
  return grammar.elements[tag] ?? NONE;
}

export function groupOf(tag: string): GroupName | null {
  for (const g of ["conditions", "actions", "tokens"] as GroupName[]) {
    if (grammar.groups[g].includes(tag)) {
      return g;
    }
  }
  return null;
}

/** Every element name a parent may hold, in grammar order. */
export function allowedChildren(parent: string): string[] {
  const out: string[] = [];
  for (const c of spec(parent).children) {
    if (c.group) {
      out.push(...grammar.groups[c.group]);
    } else if (c.name) {
      out.push(c.name);
    }
  }
  return out;
}

/** The child spec that governs `child` under `parent`, with its position in the parent's order. */
export function childSpec(parent: string, child: string): { spec: ChildSpec; order: number } | null {
  const list = spec(parent).children;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (c.name === child || (c.group && grammar.groups[c.group].includes(child))) {
      return { spec: c, order: i };
    }
  }
  return null;
}

const WORDS: Record<string, string> = { dest: "destination", src: "source", attr: "attribute", op: "operation", dn: "DN", xml: "XML", xpath: "XPath", sso: "SSO", xdas: "XDAS", ecmascript: "ECMAScript" };

/** `do-set-dest-attr-value` → "set destination attribute value"; `token-op-attr` → "operation attribute". */
export function label(tag: string): string {
  const body = tag.replace(/^(do|if|token|arg)-/, "");
  return body
    .split("-")
    .map((w) => WORDS[w] ?? w)
    .join(" ");
}
