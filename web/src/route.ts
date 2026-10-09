import { NEW_WHATS } from "./types";
import type { NewWhat, Selection } from "./types";

/**
 * The selection as the address bar's fragment (`#type=file&file=drivers/x.xml`), so the
 * browser's Back and Forward move between views, a reload keeps the place, and a link can be
 * shared. The session token also travels in the fragment once, on arrival; `takeToken` removes
 * it before this is read.
 */
export function toHash(s: Selection): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(s)) {
    if (v !== null && v !== undefined && v !== "") {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return "#" + parts.join("&");
}

export function fromHash(hash: string): Selection | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw || raw.includes("token=")) {
    return null;
  }
  const m: Record<string, string> = {};
  for (const part of raw.split("&")) {
    const i = part.indexOf("=");
    if (i > 0) {
      m[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1));
    }
  }
  const d = (k: string) => (m[k] === undefined ? null : m[k]);
  switch (m.type) {
    case "home":
    case "overrides":
    case "projects":
    case "architecture":
    case "developer":
    case "audit":
    case "operations":
    case "vault":
    case "simulator":
    case "roles":
    case "packages":
      return { type: m.type };
    case "driverset":
      return m.tab === "schema" || m.tab === "gcvs" ? { type: "driverset", tab: m.tab } : { type: "driverset" };
    case "trace": {
      const base = m.file ? { type: "trace" as const, file: m.file } : m.env ? { type: "trace" as const, env: m.env } : null;
      return base ? (m.popout === "1" ? { ...base, popout: "1" } : base) : null;
    }
    case "traces":
      return { type: "traces" };
    case "flow":
      return m.driver ? { type: "flow", driver: m.driver } : null;
    case "artifact":
      return m.path ? { type: "artifact", path: m.path } : null;
    case "file":
      return m.file ? { type: "file", file: m.file } : null;
    case "config":
      return { type: "config", driver: d("driver") };
    case "prd":
      return m.driver && m.name ? { type: "prd", driver: m.driver, name: m.name } : null;
    case "form":
      return m.driver && m.name ? { type: "form", driver: m.driver, name: m.name } : null;
    case "entitlement":
      return m.driver && m.name && m.file ? { type: "entitlement", driver: m.driver, name: m.name, file: m.file } : null;
    case "connections":
      return { type: "connections", ...(m.env ? { env: m.env } : {}) };
    case "changes":
      return { type: "changes", ...(m.against === "base" || m.against === "upstream" ? { against: m.against } : {}) };
    case "new":
      return (NEW_WHATS as string[]).includes(m.what ?? "") ? { type: "new", what: m.what as NewWhat, driver: d("driver") } : null;
    default:
      return null;
  }
}
