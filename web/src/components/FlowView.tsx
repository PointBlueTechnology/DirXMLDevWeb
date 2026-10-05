import { useEffect, useState } from "react";
import { api } from "../api";
import type { FishboneModel } from "../fishbone/types";
import { renderSvg } from "../fishbone/render";

interface Props {
  driver: string;
  revision: string;
  onOpen: (path: string) => void;
  onOpenFile: (file: string) => void;
}

/** A driver's policy flow: the fishbone the VS Code extension draws, from the same model. */
export function FlowView({ driver, revision, onOpen, onOpenFile }: Props) {
  const [model, setModel] = useState<FishboneModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    api
      .fishbone(driver)
      .then((m) => !gone && (setModel(m), setError(null)))
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [driver, revision]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!model) {
    return <p className="muted pad">Loading the policy flow…</p>;
  }

  const click = (ev: React.MouseEvent<HTMLDivElement>) => {
    const node = (ev.target as Element).closest("[data-node]");
    const id = node?.getAttribute("data-node");
    if (!id) {
      return;
    }
    if (id.startsWith("policy:")) {
      // policy:<set>:<order>:<artifact path>
      const ref = id.split(":").slice(3).join(":");
      onOpen(ref);
    } else if (id === model.filter?.id && model.filter) {
      onOpenFile(model.filter.file);
    }
  };

  return (
    <div className="flow">
      <div className="viewhead">
        <div>
          <div className="kicker">Policy flow</div>
          <h2>{model.driver.name}</h2>
          <div className="muted small">{model.driver.shimClass ?? ""}</div>
        </div>
        <div className="legend">
          <span className="swatch pub" /> Publisher (application → Identity Vault)
          <span className="swatch sub" /> Subscriber (Identity Vault → application)
        </div>
      </div>
      <p className="muted small pad-x">Click a policy to open it. The filter tile opens the filter.</p>
      <div className="fishbone" onClick={click} dangerouslySetInnerHTML={{ __html: renderSvg(model) }} />
    </div>
  );
}
