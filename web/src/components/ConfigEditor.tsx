import { useEffect, useState } from "react";
import { api } from "../api";
import { usePending } from "../pending";
import type { ArtifactNode, ConfigView, DriverOutline, OverridesData } from "../types";
import { ChainsEditor } from "./ChainsEditor";
import { FilterEditor } from "./FilterEditor";
import { GcvEditor } from "./GcvEditor";
import { PendingBar } from "./PendingBar";
import { SettingsEditor } from "./SettingsEditor";

interface Props {
  /** null: the driver set. */
  driver: DriverOutline | null;
  setName: string;
  revision: string;
  canOverride: boolean;
  linkable: ArtifactNode[];
  onOpen: (path: string) => void;
  onSaved: () => void;
}

type Tab = "gcvs" | "settings" | "filter" | "chains";

/** One driver's configuration (or the driver set's GCVs), with one set of pending changes across its tabs. */
export function ConfigEditor({ driver, setName, revision, canOverride, linkable, onOpen, onSaved }: Props) {
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [overrides, setOverrides] = useState<OverridesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("gcvs");
  const pending = usePending();
  const name = driver?.name ?? null;

  useEffect(() => {
    let gone = false;
    Promise.all([api.config(name), api.overrides()])
      .then(([c, o]) => {
        if (!gone) {
          setConfig(c);
          setOverrides(o);
          setError(null);
        }
      })
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [name, revision]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!config) {
    return <p className="muted pad">Loading the configuration…</p>;
  }
  const filterFile = driver?.config.find((f) => f.endsWith("/driver-filter.xml")) ?? null;
  const tabs: [Tab, string][] = driver
    ? [
        ["gcvs", `GCVs ${config.gcvs.length}`],
        ["settings", "Settings"],
        ["filter", "Filter"],
        ["chains", "Policy sets"],
      ]
    : [["gcvs", `GCVs ${config.gcvs.length}`]];

  return (
    <div className="view">
      <div className="viewhead">
        <div>
          <div className="kicker">{driver ? "driver configuration" : "driver set configuration"}</div>
          <h2>{driver?.name ?? setName}</h2>
          <div className="muted small">{driver ? (driver.shimClass ?? "") : "GCVs every driver in the set can read"}</div>
        </div>
      </div>
      <PendingBar pending={pending} title={`Review changes to ${driver?.name ?? setName}`} onSaved={onSaved} />
      <div className="tabs">
        {tabs.map(([t, label]) => (
          <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>
      <div className="scroll">
        {tab === "gcvs" && <GcvEditor config={config} overrides={overrides} canOverride={canOverride} pending={pending} onOpen={onOpen} />}
        {tab === "settings" && driver && <SettingsEditor config={config} pending={pending} />}
        {tab === "filter" && driver && <FilterEditor driver={driver.name} file={filterFile} revision={revision} pending={pending} />}
        {tab === "chains" && driver && <ChainsEditor driver={driver.name} revision={revision} pending={pending} linkable={linkable} onOpen={onOpen} />}
      </div>
    </div>
  );
}
