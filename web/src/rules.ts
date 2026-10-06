// A read-only structured view of a DirXML Script policy: its rules, each with what it tests and
// what it does, summarised from the XML. The structured *editor* (W2) grows from this module.

export interface RuleSummary {
  index: number;
  description: string;
  disabled: boolean;
  conditions: string[];
  /** How the condition groups combine: "and of ors" / "or of ands" as DirXML Script nests them. */
  logic: string;
  actions: string[];
}

export interface PolicySummary {
  kind: "dirxml-script" | "other";
  rules: RuleSummary[];
  error?: string;
}

const KEY_ATTRS = ["name", "class-name", "op", "mode", "level", "table", "src", "dest", "expression", "notification-dn", "template-dn", "id"];

function attrs(e: Element): string {
  const parts: string[] = [];
  for (const a of KEY_ATTRS) {
    const v = e.getAttribute(a);
    if (v !== null && v !== "") {
      parts.push(a === "name" || a === "op" ? v : `${a}=${v}`);
    }
  }
  return parts.join(" ");
}

function text(e: Element): string {
  const t = (e.textContent ?? "").replace(/\s+/g, " ").trim();
  return t.length > 60 ? t.slice(0, 58) + "…" : t;
}

function children(e: Element, name?: string): Element[] {
  return Array.from(e.children).filter((c) => name === undefined || c.tagName === name);
}

/** `if-op-attr Title changing`, `if-global-variable drv.x equal "true"`. */
export function describeCondition(e: Element): string {
  const value = e.children.length === 0 ? text(e) : "";
  return [e.tagName, attrs(e), value ? `"${value}"` : ""].filter(Boolean).join(" ");
}

/** `do-set-dest-attr-value title`, `do-veto`. Nested tokens are not expanded here. */
export function describeAction(e: Element): string {
  const tokens = Array.from(e.querySelectorAll("*"))
    .filter((t) => t.tagName.startsWith("token-"))
    .map((t) => t.tagName.replace(/^token-/, "") + (t.getAttribute("name") ? `(${t.getAttribute("name")})` : t.children.length === 0 && text(t) ? `("${text(t)}")` : ""));
  const disabled = e.getAttribute("disabled") === "true" ? " [disabled]" : "";
  return [e.tagName, attrs(e)].filter(Boolean).join(" ") + (tokens.length ? " ← " + tokens.slice(0, 4).join(" + ") + (tokens.length > 4 ? " …" : "") : "") + disabled;
}

/** One line for any element of a policy: a condition, an action, a token, an argument. */
export function describeNode(e: Element): string {
  if (e.tagName.startsWith("if-")) {
    return describeCondition(e);
  }
  if (e.tagName.startsWith("do-")) {
    return describeAction(e);
  }
  const own = e.children.length === 0 ? text(e) : "";
  const inner = e.children.length > 0 ? ` (${Array.from(e.children).map((c) => c.tagName.replace(/^(token|arg)-/, "")).slice(0, 5).join(", ")}${e.children.length > 5 ? ", …" : ""})` : "";
  return [e.tagName, attrs(e), own ? `"${own}"` : ""].filter(Boolean).join(" ") + inner;
}

function describe(d: Element | undefined, i: number): string {
  const t = d ? (d.textContent ?? "").replace(/\s+/g, " ").trim() : "";
  return t || `rule ${i + 1}`;
}

export function summarize(xml: string): PolicySummary {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch (e) {
    return { kind: "other", rules: [], error: String(e) };
  }
  const err = doc.querySelector("parsererror");
  if (err) {
    return { kind: "other", rules: [], error: (err.textContent ?? "not well-formed XML").split("\n")[0] };
  }
  const root = doc.documentElement;
  if (root.tagName !== "policy") {
    return { kind: "other", rules: [] };
  }
  const rules: RuleSummary[] = children(root, "rule").map((rule, i) => {
    const conds = children(rule, "conditions")[0];
    const groups = conds ? children(conds).filter((g) => g.tagName === "and" || g.tagName === "or") : [];
    const conditions: string[] = [];
    for (const g of groups) {
      for (const c of children(g)) {
        conditions.push(describeCondition(c));
      }
    }
    const inner = groups[0]?.tagName ?? "and";
    const acts = children(rule, "actions")[0];
    return {
      index: i + 1,
      description: describe(children(rule, "description")[0], i),
      disabled: rule.getAttribute("disabled") === "true",
      conditions,
      logic: groups.length > 1 ? (inner === "and" ? "any group of all" : "every group of any") : inner === "or" ? "any of" : "all of",
      actions: acts ? children(acts).map(describeAction) : [],
    };
  });
  return { kind: "dirxml-script", rules };
}
