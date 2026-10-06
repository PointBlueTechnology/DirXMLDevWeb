/**
 * A DirXML-Entitlement definition, read for the editor: the attributes Designer's entitlement
 * editor shows, and how its values come — none (the requester supplies one), a static list, or
 * a query the driver runs against the application.
 */
export interface EntitlementQuery {
  className: string | null;
  scope: string | null;
  searchClasses: string[];
  readAttrs: string[];
  displayName: string | null;
  description: string | null;
  value: string | null;
}

export interface EntitlementDoc {
  displayName: string;
  description: string;
  conflict: string;
  multiValued: boolean | null;
  mode: "none" | "static" | "query";
  values: string[];
  query: EntitlementQuery | null;
  error: string | null;
}

function tokenText(el: Element | null): string | null {
  if (!el) {
    return null;
  }
  const parts: string[] = [];
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 1) {
      const e = n as Element;
      parts.push(e.tagName === "token-attr" ? `{${e.getAttribute("attr-name") ?? ""}}` : e.tagName === "token-src-dn" ? "{src-dn}" : e.tagName === "token-association" ? "{association}" : `{${e.tagName}}`);
    } else if (n.nodeType === 3 && (n.nodeValue ?? "").trim()) {
      parts.push((n.nodeValue ?? "").trim());
    }
  }
  return parts.join("");
}

export function parseEntitlement(xml: string): EntitlementDoc {
  const empty: EntitlementDoc = { displayName: "", description: "", conflict: "priority", multiValued: null, mode: "none", values: [], query: null, error: null };
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName("parsererror").length > 0) {
    return { ...empty, error: "the definition is not well-formed XML" };
  }
  if (root.tagName !== "entitlement") {
    return { ...empty, error: `the root element is <${root.tagName}>, not <entitlement>` };
  }
  const out: EntitlementDoc = {
    ...empty,
    displayName: root.getAttribute("display-name") ?? "",
    description: root.getAttribute("description") ?? "",
    conflict: root.getAttribute("conflict-resolution") ?? "priority",
  };
  const values = Array.from(root.children).find((c) => c.tagName === "values") ?? null;
  if (values) {
    const mv = values.getAttribute("multi-valued");
    out.multiValued = mv === null ? null : mv === "true";
    const query = Array.from(values.children).find((c) => c.tagName === "query-app") ?? null;
    if (query) {
      out.mode = "query";
      const q = query.getElementsByTagName("query")[0] ?? null;
      const rs = Array.from(query.children).find((c) => c.tagName === "result-set") ?? null;
      out.query = {
        className: q?.getAttribute("class-name") ?? null,
        scope: q?.getAttribute("scope") ?? null,
        searchClasses: q ? Array.from(q.getElementsByTagName("search-class")).map((e) => e.getAttribute("class-name") ?? "") : [],
        readAttrs: q ? Array.from(q.getElementsByTagName("read-attr")).map((e) => e.getAttribute("attr-name") ?? "") : [],
        displayName: tokenText(rs ? (Array.from(rs.children).find((c) => c.tagName === "display-name") ?? null) : null),
        description: tokenText(rs ? (Array.from(rs.children).find((c) => c.tagName === "description") ?? null) : null),
        value: tokenText(rs ? (Array.from(rs.children).find((c) => c.tagName === "ent-value") ?? null) : null),
      };
    } else {
      const list = Array.from(values.children).filter((c) => c.tagName === "value").map((c) => c.textContent ?? "");
      out.mode = list.length > 0 ? "static" : "none";
      out.values = list;
    }
  }
  return out;
}

/**
 * The definition with the editor's attributes and a static value list written back into it; the
 * rest of the document (a query, comments, order) is kept. Values go through the document, not
 * the `--values` list: a value is the connected system's own key for the thing granted, as in an
 * association — a GUID, an id, a name, sometimes a DN — and the typed list is comma-separated.
 */
export function writeEntitlement(xml: string, fields: { displayName: string; description: string; conflict: string; multiValued: boolean }, values: string[] | null): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  root.setAttribute("display-name", fields.displayName);
  if (fields.description) {
    root.setAttribute("description", fields.description);
  } else {
    root.removeAttribute("description");
  }
  root.setAttribute("conflict-resolution", fields.conflict);
  let valuesEl = Array.from(root.children).find((c) => c.tagName === "values") ?? null;
  if (!valuesEl) {
    valuesEl = doc.createElement("values");
    root.appendChild(valuesEl);
  }
  valuesEl.setAttribute("multi-valued", String(fields.multiValued));
  if (values !== null) {
    for (const c of Array.from(valuesEl.childNodes)) {
      valuesEl.removeChild(c);
    }
    for (const v of values) {
      const e = doc.createElement("value");
      e.textContent = v;
      valuesEl.appendChild(e);
    }
  }
  const out = new XMLSerializer().serializeToString(doc);
  return (xml.startsWith("<?xml") && !out.startsWith("<?xml") ? xml.slice(0, xml.indexOf("?>") + 2) + "\n" : "") + out + "\n";
}
