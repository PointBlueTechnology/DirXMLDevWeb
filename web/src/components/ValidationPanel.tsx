import type { Validation } from "../types";

export function ValidationPanel({ validation, onOpen }: { validation: Validation | null; onOpen: (path: string) => void }) {
  if (!validation) {
    return <p className="muted pad">Validating…</p>;
  }
  const { counts, findings } = validation;
  const order = { ERROR: 0, WARNING: 1, INFO: 2 } as Record<string, number>;
  const sorted = [...findings].sort((a, b) => (order[a.severity.toUpperCase()] ?? 3) - (order[b.severity.toUpperCase()] ?? 3));
  return (
    <div className="validation">
      <div className="panelhead">
        <strong>Validation</strong>
        <span className={counts.error > 0 ? "pill err" : "pill ok"}>{counts.error} errors</span>
        <span className="pill warn">{counts.warning} warnings</span>
        <span className="pill">{counts.info} info</span>
      </div>
      {sorted.length === 0 ? (
        <p className="muted pad">No findings. Every check the core runs passed.</p>
      ) : (
        <ul className="findings">
          {sorted.map((f, i) => (
            <li key={i} className={"finding " + f.severity.toLowerCase()}>
              <button onClick={() => onOpen(f.path)} title="Open">
                <span className="code">{f.code}</span>
                <span className="path">{f.path}</span>
                <span className="msg">{f.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
