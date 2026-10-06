import { useMemo } from "react";
import type { Finding, Validation } from "../types";

export const SEVERITIES = ["error", "warning", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];
const ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

/** "3 errors", "1 warning", "199 info". */
function label(n: number, s: Severity): string {
  return `${n} ${s}${s === "info" || n === 1 ? "" : "s"}`;
}

/** The module a finding belongs to — a driver, the Library, the driver set — and the path inside it. */
export function moduleOf(path: string): { module: string; rest: string; order: number } {
  const parts = path.split("/");
  if (parts[0] === "drivers" && parts.length > 1) {
    return { module: parts[1]!, rest: parts.slice(2).join("/"), order: 2 };
  }
  if (parts[0] === "library") {
    return { module: "Library", rest: parts.slice(1).join("/"), order: 1 };
  }
  if (path === "driverset" || parts[0] === "driverset" || path === "" || parts[0]!.endsWith(".xml")) {
    return { module: "Driver set", rest: path === "driverset" ? "" : path, order: 0 };
  }
  return { module: parts[0]!, rest: parts.slice(1).join("/"), order: 3 };
}

function pillClass(s: Severity, counts: { error: number }): string {
  return "pill " + (s === "error" ? (counts.error > 0 ? "err" : "ok") : s === "warning" ? "warn" : "");
}

/**
 * The counts, always on screen (the top bar): each bubble opens the findings filtered to that
 * severity; the word opens them unfiltered.
 */
export function ValidationSummary({ validation, open, onPick }: { validation: Validation | null; open: boolean; onPick: (only: Severity | null) => void }) {
  const counts = validation?.counts ?? { error: 0, warning: 0, info: 0 };
  return (
    <span className="vsummary" data-testid="validation-summary">
      <button className="linkish" onClick={() => onPick(null)} title={open ? "Hide the findings" : "Show every finding"} data-testid="validation-toggle">
        Validation {open ? "▾" : "▸"}
      </button>
      {SEVERITIES.map((s) => (
        <button key={s} className={pillClass(s, counts)} onClick={() => onPick(s)} title={`Show the ${s}s`} data-testid={"validation-count-" + s}>
          {validation ? label(counts[s], s) : `… ${s}`}
        </button>
      ))}
    </span>
  );
}

interface Props {
  validation: Validation | null;
  show: Set<Severity>;
  onToggle: (s: Severity) => void;
  onOpen: (path: string) => void;
  onHide: () => void;
}

/** The findings, grouped by the module they occur in (each driver, the Library, the driver set), at the chosen severities. */
export function ValidationPanel({ validation, show, onToggle, onOpen, onHide }: Props) {
  const groups = useMemo(() => {
    const by = new Map<string, { module: string; order: number; items: (Finding & { rest: string })[]; counts: Record<Severity, number> }>();
    for (const f of validation?.findings ?? []) {
      const { module, rest, order } = moduleOf(f.path);
      let g = by.get(module);
      if (!g) {
        g = { module, order, items: [], counts: { error: 0, warning: 0, info: 0 } };
        by.set(module, g);
      }
      const sev = f.severity.toLowerCase() as Severity;
      if (sev in g.counts) {
        g.counts[sev]++;
      }
      g.items.push({ ...f, rest });
    }
    const list = [...by.values()];
    for (const g of list) {
      g.items.sort((a, b) => (ORDER[a.severity.toLowerCase()] ?? 3) - (ORDER[b.severity.toLowerCase()] ?? 3) || a.rest.localeCompare(b.rest));
    }
    // modules with errors first, then by kind (driver set, Library, drivers), then by name
    list.sort((a, b) => (b.counts.error > 0 ? 1 : 0) - (a.counts.error > 0 ? 1 : 0) || a.order - b.order || a.module.localeCompare(b.module));
    return list;
  }, [validation]);

  const counts = validation?.counts ?? { error: 0, warning: 0, info: 0 };
  const visible = (f: Finding) => show.has(f.severity.toLowerCase() as Severity);
  const shown = groups.map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length > 0);

  return (
    <div className="validation" data-testid="validation">
      <div className="panelhead sevfilter" data-testid="validation-filter">
        {SEVERITIES.map((s) => (
          <button key={s} className={pillClass(s, counts) + (show.has(s) ? " on" : " off")} onClick={() => onToggle(s)} title={show.has(s) ? `Hide the ${s}s` : `Show the ${s}s`} aria-pressed={show.has(s)} data-testid={"validation-sev-" + s}>
            {label(counts[s], s)}
          </button>
        ))}
        <span className="spacer" />
        <button className="linkish" onClick={onHide} title="Hide the findings (the counts stay in the top bar)" data-testid="validation-hide">
          hide ▸
        </button>
      </div>
      {!validation ? (
        <p className="muted pad">Validating…</p>
      ) : validation.findings.length === 0 ? (
        <p className="muted pad">No findings. Every check the core runs passed.</p>
      ) : shown.length === 0 ? (
        <p className="muted pad">Nothing at the selected severities.</p>
      ) : (
        shown.map((g) => (
          <details key={g.module} className="fgroup" open={g.counts.error > 0 || shown.length <= 3} data-testid="validation-group">
            <summary>
              <span className="module">{g.module}</span>
              <span className="gcounts">
                {g.counts.error > 0 && show.has("error") && <span className="err-text">{g.counts.error}</span>}
                {g.counts.warning > 0 && show.has("warning") && <span className="warn-text">{g.counts.warning}</span>}
                {g.counts.info > 0 && show.has("info") && <span className="muted">{g.counts.info}</span>}
              </span>
            </summary>
            <ul className="findings">
              {g.items.map((f, i) => (
                <li key={f.path + f.code + i} className={"finding " + f.severity.toLowerCase()}>
                  <button onClick={() => onOpen(f.path)} title={f.path}>
                    <span className="code">{f.code}</span>
                    {f.rest && <span className="path">{f.rest}</span>}
                    <span className="msg">{f.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))
      )}
    </div>
  );
}
