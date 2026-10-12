import { useState } from "react";
import type { ArtifactNode, Outline, Selection } from "../types";
import { ConfigEditor } from "./ConfigEditor";
import { SchemaView } from "./SchemaView";
import { DesignerExportPanel } from "./DesignerExportPanel";
import { isUserApplication } from "../drivers";

/**
 * The driver set itself: where it is, the servers it runs on, what is linked at the driver-set
 * level (package GCV objects, shared resources), the packages recorded on it, its drivers; and
 * its GCVs, editable, with the env-override columns.
 */
export function DriverSetView({ outline, revision, canOverride, linkable, initialTab, onOpen, onSelect, onSaved }: { outline: Outline; revision: string; canOverride: boolean; linkable: ArtifactNode[]; initialTab?: "overview" | "gcvs" | "schema" | "designer"; onOpen: (path: string) => void; onSelect: (s: Selection) => void; onSaved: () => void }) {
  const [tab, setTab] = useState<"overview" | "gcvs" | "schema" | "designer">(initialTab ?? "overview");
  const ds = outline.driverSet;
  const pkgs = Object.entries(ds.packages);
  const meta = Object.entries(ds.meta).filter(([k]) => !k.startsWith("source."));
  return (
    <div className="view driverset">
      <div className="viewhead">
        <div>
          <div className="kicker">driver set</div>
          <h2>{ds.name}</h2>
        </div>
        <span className="spacer" />
        <div className="tabs">
          <button className={tab === "overview" ? "tab active" : "tab"} onClick={() => setTab("overview")}>
            Overview
          </button>
          <button className={tab === "gcvs" ? "tab active" : "tab"} onClick={() => setTab("gcvs")} data-testid="ds-tab-gcvs">
            GCVs
          </button>
          <button className={tab === "schema" ? "tab active" : "tab"} onClick={() => setTab("schema")} data-testid="ds-tab-schema">
            Schema{ds.schema ? ` ${ds.schema.classes}` : ""}
          </button>
          <button className={tab === "designer" ? "tab active" : "tab"} onClick={() => setTab("designer")} title="Export for Designer: the export XML, or a Designer project updated or written new" data-testid="ds-tab-designer">
            Designer
          </button>
        </div>
      </div>
      {tab === "designer" && <DesignerExportPanel drivers={outline.drivers.map((d) => d.name)} />}
      {tab === "schema" && <SchemaView revision={revision} onSaved={onSaved} />}
      {tab === "gcvs" && <ConfigEditor driver={null} setName={ds.name} revision={revision} canOverride={canOverride} linkable={linkable} onOpen={onOpen} onSaved={onSaved} />}
      {tab === "overview" && (
        <div className="pad scroll" data-testid="ds-overview">
          <table className="grid">
            <tbody>
              <tr>
                <th>DN</th>
                <td>
                  <code>{ds.dn ?? "not recorded"}</code>
                </td>
              </tr>
              <tr>
                <th>Servers</th>
                <td>
                  {ds.servers.length === 0 ? (
                    <span className="muted">none recorded (a tree from a Designer project has no server until it is deployed)</span>
                  ) : (
                    ds.servers.map((s) => (
                      <div key={s.dn}>
                        <code title={s.dn}>{s.name}</code>
                        {s.primary && <span className="pill ok"> primary (the one the tree was read from)</span>}
                      </div>
                    ))
                  )}
                  <div className="muted small">Each server keeps its own trace and driver state; the Vault view's Trace tab picks one. Per-server shim settings are on each driver's Configuration.</div>
                </td>
              </tr>
              <tr>
                <th>Drivers</th>
                <td>
                  {outline.drivers.map((d) => (
                    <div key={d.name}>
                      <button className="link" onClick={() => onSelect({ type: "flow", driver: d.name })}>
                        {d.name}
                      </button>
                      <span className="muted small">
                        {" "}
                        {d.shimClass ?? "no shim class"}
                        {isUserApplication(d) ? " · User Application" : ""}
                      </span>
                    </div>
                  ))}
                  <button className="link" onClick={() => onSelect({ type: "new", what: "driver", driver: null })}>
                    + new driver
                  </button>
                </td>
              </tr>
              <tr>
                <th>Library</th>
                <td>
                  {ds.libraryItems} item{ds.libraryItems === 1 ? "" : "s"} ({outline.library.policies.length} polic{outline.library.policies.length === 1 ? "y" : "ies"}, {outline.library.resources.length} resource
                  {outline.library.resources.length === 1 ? "" : "s"})
                </td>
              </tr>
              <tr>
                <th>Linked at the driver set</th>
                <td>
                  {ds.linkage.length === 0 ? (
                    <span className="muted">nothing (driver-set GCV objects from packages appear here)</span>
                  ) : (
                    ds.linkage.map((l) => (
                      <div key={l.dn}>
                        <code title={l.dn}>{l.name}</code>
                        <span className="muted small">
                          {" "}
                          order {l.order ?? "?"}
                          {l.type ? `, type ${l.type}` : ""}
                        </span>
                      </div>
                    ))
                  )}
                </td>
              </tr>
              <tr>
                <th>Packages recorded</th>
                <td>
                  {pkgs.length === 0 ? <span className="muted">none (the Packages view shows what the objects carry)</span> : pkgs.map(([k, v]) => (
                    <div key={k}>
                      <code>{k}</code> <span className="muted small">{v}</span>
                    </div>
                  ))}{" "}
                  <button className="link" onClick={() => onSelect({ type: "packages" })}>
                    Packages view
                  </button>
                </td>
              </tr>
              <tr>
                <th>Env overrides</th>
                <td>
                  <button className="link" onClick={() => onSelect({ type: "overrides" })}>
                    values that differ per environment
                  </button>
                </td>
              </tr>
              {meta.length > 0 && (
                <tr>
                  <th>Other</th>
                  <td>
                    {meta.map(([k, v]) => (
                      <div key={k} className="small">
                        <code>{k}</code> {v}
                      </div>
                    ))}
                  </td>
                </tr>
              )}
              <tr>
                <th>Files</th>
                <td>
                  <button className="link" onClick={() => onSelect({ type: "file", file: "driverset.xml" })}>
                    driverset.xml
                  </button>
                  {ds.config.map((f) => (
                    <span key={f}>
                      {" · "}
                      <button className="link" onClick={() => onSelect({ type: "file", file: f })}>
                        {f}
                      </button>
                    </span>
                  ))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
