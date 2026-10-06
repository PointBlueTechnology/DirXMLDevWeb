import type { ArtifactNode, DriverOutline, Outline, Selection } from "../types";

interface Props {
  outline: Outline;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

const KIND_BADGE: Record<string, string> = {
  "dirxml-script": "DS",
  xslt: "XSL",
  "schema-map": "MAP",
  "mapping-table": "TBL",
  ecmascript: "JS",
  gcv: "GCV",
};

export function OutlineTree({ outline, selection, onSelect }: Props) {
  const isArtifact = (p: string) => selection.type === "artifact" && selection.path === p;
  const isFile = (f: string) => selection.type === "file" && selection.file === f;

  const artifacts = (label: string, nodes: ArtifactNode[]) =>
    nodes.length === 0 ? null : (
      <details open>
        <summary>
          {label} <span className="count">{nodes.length}</span>
        </summary>
        <ul>
          {nodes.map((n) => (
            <li key={n.path}>
              <button className={isArtifact(n.path) ? "leaf active" : "leaf"} onClick={() => onSelect({ type: "artifact", path: n.path })} title={n.path}>
                <span className="badge">{KIND_BADGE[n.kind] ?? "·"}</span>
                {n.name}
              </button>
            </li>
          ))}
        </ul>
      </details>
    );

  const files = (label: string, list: { name: string; file: string | null }[]) =>
    list.length === 0 ? null : (
      <details>
        <summary>
          {label} <span className="count">{list.length}</span>
        </summary>
        <ul>
          {list.map((n) => (
            <li key={n.name + (n.file ?? "")}>
              <button className={n.file && isFile(n.file) ? "leaf active" : "leaf"} disabled={!n.file} onClick={() => n.file && onSelect({ type: "file", file: n.file })} title={n.file ?? "no file"}>
                <span className="badge">·</span>
                {n.name}
              </button>
            </li>
          ))}
        </ul>
      </details>
    );

  const leafName = (f: string) => f.split("/").pop() ?? f;

  const driver = (d: DriverOutline) => (
    <details key={d.name} open={outline.drivers.length <= 3}>
      <summary className="driver">{d.name}</summary>
      <div className="indent">
        <button className={selection.type === "flow" && selection.driver === d.name ? "leaf active" : "leaf"} onClick={() => onSelect({ type: "flow", driver: d.name })}>
          <span className="badge badge-flow">⇄</span>Policy flow
        </button>
        <button className={selection.type === "config" && selection.driver === d.name ? "leaf active" : "leaf"} onClick={() => onSelect({ type: "config", driver: d.name })}>
          <span className="badge badge-flow">⚙</span>Configuration
        </button>
        {files(
          "Configuration files",
          d.config.map((f) => ({ name: leafName(f), file: f })),
        )}
        {artifacts("Driver policies", d.policies.driver)}
        {artifacts("Subscriber", d.policies.subscriber)}
        {artifacts("Publisher", d.policies.publisher)}
        {artifacts("Resources", d.resources)}
        {d.entitlements.length > 0 && (
          <details>
            <summary>
              Entitlements <span className="count">{d.entitlements.length}</span>
            </summary>
            <ul>
              {d.entitlements.map((e) => (
                <li key={e.name}>
                  <button
                    className={selection.type === "entitlement" && selection.driver === d.name && selection.name === e.name ? "leaf active" : "leaf"}
                    disabled={!e.file}
                    onClick={() => e.file && onSelect({ type: "entitlement", driver: d.name, name: e.name, file: e.file })}
                    title={e.file ?? ""}
                  >
                    <span className="badge">ENT</span>
                    {e.name}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {d.forms.length > 0 && (
          <details>
            <summary>
              Forms <span className="count">{d.forms.length}</span>
            </summary>
            <ul>
              {d.forms.map((f) => (
                <li key={f.kind + "/" + f.name}>
                  <button
                    className={selection.type === "form" && selection.driver === d.name && selection.name === f.name ? "leaf active" : "leaf"}
                    onClick={() => onSelect({ type: "form", driver: d.name, name: f.name })}
                    title={f.file ?? ""}
                  >
                    <span className="badge">{f.kind === "approval" ? "AP" : f.kind === "request" ? "RQ" : "TP"}</span>
                    {f.name}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {d.prds.length > 0 && (
          <details>
            <summary>
              PRDs <span className="count">{d.prds.length}</span>
            </summary>
            <ul>
              {d.prds.map((p) => (
                <li key={p.name}>
                  <button
                    className={selection.type === "prd" && selection.driver === d.name && selection.name === p.name ? "leaf active" : "leaf"}
                    onClick={() => onSelect({ type: "prd", driver: d.name, name: p.name })}
                  >
                    <span className="badge">WF</span>
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  );

  return (
    <div className="outline">
      <button className={selection.type === "home" ? "leaf active root" : "leaf root"} onClick={() => onSelect({ type: "home" })}>
        {outline.driverSet.name}
      </button>
      <button className={selection.type === "config" && selection.driver === null ? "leaf active" : "leaf"} onClick={() => onSelect({ type: "config", driver: null })}>
        <span className="badge badge-flow">⚙</span>Driver set GCVs
      </button>
      <button className={selection.type === "overrides" ? "leaf active" : "leaf"} onClick={() => onSelect({ type: "overrides" })}>
        <span className="badge badge-flow">≠</span>Stage overrides
      </button>
      {files(
        "Driver set files",
        outline.driverSet.config.map((f) => ({ name: f, file: f })),
      )}
      {(outline.library.policies.length > 0 || outline.library.resources.length > 0) && (
        <details open>
          <summary className="driver">Library</summary>
          <div className="indent">
            {artifacts("Policies", outline.library.policies)}
            {artifacts("Resources", outline.library.resources)}
          </div>
        </details>
      )}
      {outline.drivers.map(driver)}
    </div>
  );
}
