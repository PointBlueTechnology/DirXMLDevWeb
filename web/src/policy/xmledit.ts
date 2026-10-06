// Structured edits to a DirXML Script document. The document is always the XML string (the one
// draft the Source tab also shows); an edit parses it, changes the DOM, and serialises it back.
// An element is addressed by its path: the element-child index at each level under the root.
import { childSpec, spec } from "./grammar";

export type Path = number[];

export function parse(xml: string): Document | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.querySelector("parsererror") ? null : doc;
}

export function elementChildren(e: Element): Element[] {
  return Array.from(e.children);
}

export function at(doc: Document, path: Path): Element | null {
  let e: Element | null = doc.documentElement;
  for (const i of path) {
    e = e ? (elementChildren(e)[i] ?? null) : null;
  }
  return e;
}

/** An element's own text: what it holds when it has no element children. */
export function ownText(e: Element): string {
  return e.children.length === 0 ? (e.textContent ?? "") : "";
}

/**
 * A new element of a type, valid enough to be completed: required attributes present (an
 * enumerated one at its first value, a free one empty) and required children created.
 */
export function create(doc: Document, tag: string, depth = 0): Element {
  const e = doc.createElement(tag);
  const s = spec(tag);
  for (const a of s.attrs) {
    if (a.required) {
      e.setAttribute(a.name, a.values?.[0] ?? "");
    }
  }
  if (depth < 4) {
    for (const c of s.children) {
      if (c.name && c.min > 0) {
        for (let i = 0; i < c.min; i++) {
          e.appendChild(create(doc, c.name, depth + 1));
        }
      }
    }
  }
  if (tag === "conditions") {
    e.appendChild(doc.createElement("and"));
  }
  return e;
}

/** Insert a child where the grammar's order puts it: after the last sibling that may precede it. */
export function insertOrdered(parent: Element, child: Element): void {
  const mine = childSpec(parent.tagName, child.tagName)?.order ?? Number.MAX_SAFE_INTEGER;
  let before: Element | null = null;
  for (const sib of elementChildren(parent)) {
    const theirs = childSpec(parent.tagName, sib.tagName)?.order ?? Number.MAX_SAFE_INTEGER;
    if (theirs > mine) {
      before = sib;
      break;
    }
  }
  parent.insertBefore(child, before);
}

/** The index a new child of `tag` gets under `parent` (what {@link insertOrdered} does). */
export function insertIndex(parent: Element, tag: string): number {
  const mine = childSpec(parent.tagName, tag)?.order ?? Number.MAX_SAFE_INTEGER;
  const sibs = elementChildren(parent);
  const i = sibs.findIndex((s) => (childSpec(parent.tagName, s.tagName)?.order ?? Number.MAX_SAFE_INTEGER) > mine);
  return i < 0 ? sibs.length : i;
}

/** How many more of `tag` the parent may take (Infinity when unbounded). */
export function room(parent: Element, tag: string): number {
  const cs = childSpec(parent.tagName, tag);
  if (!cs) {
    return 0;
  }
  if (cs.spec.max === null) {
    return Infinity;
  }
  // a named child counts its own occurrences; a bounded group counts every member together
  const count = elementChildren(parent).filter((c) => childSpec(parent.tagName, c.tagName)?.order === cs.order).length;
  return Math.max(0, cs.spec.max - count);
}

/** Apply a change to the document and return the new XML, or null when the XML does not parse. */
export function edit(xml: string, change: (doc: Document) => void): string | null {
  const doc = parse(xml);
  if (!doc) {
    return null;
  }
  change(doc);
  return pretty(doc);
}

export const ops = {
  setAttr: (xml: string, path: Path, name: string, value: string | null) =>
    edit(xml, (doc) => {
      const e = at(doc, path);
      if (!e) {
        return;
      }
      if (value === null) {
        e.removeAttribute(name);
      } else {
        e.setAttribute(name, value);
      }
    }),
  setText: (xml: string, path: Path, value: string) =>
    edit(xml, (doc) => {
      const e = at(doc, path);
      if (e && e.children.length === 0) {
        e.textContent = value;
      }
    }),
  /** Set the text of a single child such as a rule's description, creating it when absent; empty text removes it. */
  setChildText: (xml: string, parent: Path, tag: string, value: string) =>
    edit(xml, (doc) => {
      const p = at(doc, parent);
      if (!p) {
        return;
      }
      let c = elementChildren(p).find((e) => e.tagName === tag) ?? null;
      if (value === "") {
        if (c) {
          p.removeChild(c);
        }
        return;
      }
      if (!c) {
        c = doc.createElement(tag);
        insertOrdered(p, c);
      }
      c.textContent = value;
    }),
  add: (xml: string, parent: Path, tag: string) =>
    edit(xml, (doc) => {
      const p = at(doc, parent);
      if (p) {
        insertOrdered(p, create(doc, tag));
      }
    }),
  remove: (xml: string, path: Path) =>
    edit(xml, (doc) => {
      const e = at(doc, path);
      e?.parentNode?.removeChild(e);
    }),
  /** Move among siblings by one place; only within the same grammar slot (an action among actions). */
  move: (xml: string, path: Path, delta: -1 | 1) =>
    edit(xml, (doc) => {
      const e = at(doc, path);
      const parent = e?.parentElement;
      if (!e || !parent) {
        return;
      }
      const sibs = elementChildren(parent);
      const i = sibs.indexOf(e);
      const other = sibs[i + delta];
      if (!other || childSpec(parent.tagName, other.tagName)?.order !== childSpec(parent.tagName, e.tagName)?.order) {
        return;
      }
      if (delta < 0) {
        parent.insertBefore(e, other);
      } else {
        parent.insertBefore(other, e);
      }
    }),
  /** Replace an element by a new one of another type (a different condition, action or token). */
  retype: (xml: string, path: Path, tag: string) =>
    edit(xml, (doc) => {
      const e = at(doc, path);
      if (!e || !e.parentNode || e.tagName === tag) {
        return;
      }
      const fresh = create(doc, tag);
      // keep what the two types have in common: same-named attributes, and the text
      for (const a of spec(tag).attrs) {
        const v = e.getAttribute(a.name);
        if (v !== null && (!a.values || a.values.includes(v))) {
          fresh.setAttribute(a.name, v);
        }
      }
      if (spec(tag).text && e.children.length === 0 && e.textContent) {
        fresh.textContent = e.textContent;
      }
      e.parentNode.replaceChild(fresh, e);
    }),
  /** `conditions` holds groups that are all `and` or all `or`: switch every group. */
  setGroupKind: (xml: string, conditions: Path, kind: "and" | "or") =>
    edit(xml, (doc) => {
      const c = at(doc, conditions);
      if (!c) {
        return;
      }
      for (const g of elementChildren(c)) {
        if ((g.tagName === "and" || g.tagName === "or") && g.tagName !== kind) {
          const n = doc.createElement(kind);
          while (g.firstChild) {
            n.appendChild(g.firstChild);
          }
          c.replaceChild(n, g);
        }
      }
    }),
};

/** Indented XML: element-only content on its own lines, text kept inline. The core re-canonicalises on save. */
export function pretty(doc: Document): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const walk = (e: Element, depth: number) => {
    const pad = "  ".repeat(depth);
    const attrs = Array.from(e.attributes)
      .map((a) => ` ${a.name}="${esc(a.value).replace(/"/g, "&quot;")}"`)
      .join("");
    const kids = elementChildren(e);
    if (kids.length === 0) {
      const text = e.textContent ?? "";
      out.push(text === "" ? `${pad}<${e.tagName}${attrs}/>` : `${pad}<${e.tagName}${attrs}>${esc(text)}</${e.tagName}>`);
      return;
    }
    out.push(`${pad}<${e.tagName}${attrs}>`);
    for (const n of Array.from(e.childNodes)) {
      if (n.nodeType === 1) {
        walk(n as Element, depth + 1);
      } else if (n.nodeType === 3 && (n.textContent ?? "").trim() !== "") {
        out.push(`${pad}  ${esc((n.textContent ?? "").trim())}`);
      } else if (n.nodeType === 8) {
        out.push(`${pad}  <!--${n.textContent ?? ""}-->`);
      }
    }
    out.push(`${pad}</${e.tagName}>`);
  };
  walk(doc.documentElement, 0);
  return out.join("\n") + "\n";
}
