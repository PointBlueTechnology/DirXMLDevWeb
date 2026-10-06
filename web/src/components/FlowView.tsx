import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { FishboneBone, FishboneModel } from "../fishbone/types";
import { renderSvg } from "../fishbone/render";
import type { ArtifactNode, OpCall, Outline } from "../types";
import { ReviewDialog } from "./ReviewDialog";

interface Props {
  driver: string;
  revision: string;
  outline: Outline | null;
  onOpen: (path: string) => void;
  onOpenFile: (file: string) => void;
  onSaved: () => Promise<void> | void;
}

/**
 * A driver's policy flow: the fishbone the VS Code extension draws, from the same model. Hovering
 * a policy shows its description; clicking a policy set opens it beside the picture, where its
 * policies are reordered, unlinked, or an existing one linked in — one reviewed change.
 */
export function FlowView({ driver, revision, outline, onOpen, onOpenFile, onSaved }: Props) {
  const [model, setModel] = useState<FishboneModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setKey, setSetKey] = useState<string | null>(null);

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

  // the open set is outlined in the picture
  useEffect(() => {
    document.querySelectorAll(".fishbone .bone.selected").forEach((el) => el.classList.remove("selected"));
    if (setKey) {
      document.querySelector(`.fishbone [data-node="bone:${CSS.escape(setKey)}"]`)?.classList.add("selected");
    }
  }, [setKey, model]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!model) {
    return <p className="muted pad">Loading the policy flow…</p>;
  }

  const bones = [...model.spine, ...model.publisher, ...model.subscriber, ...model.resources];
  const bone = setKey ? (bones.find((b) => b.key === setKey) ?? null) : null;

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
    } else if (id.startsWith("bone:")) {
      setSetKey(id.slice("bone:".length));
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
      <p className="muted small pad-x">Hover a policy for its description; click it to open it. Click a policy set to reorder, link or unlink its policies. The filter tile opens the filter.</p>
      <div className="flowbody">
        <div className="fishbone" onClick={click} dangerouslySetInnerHTML={{ __html: renderSvg(model) }} />
        {bone && <SetPanel key={bone.key + revision} driver={driver} bone={bone} outline={outline} onOpen={onOpen} onClose={() => setSetKey(null)} onSaved={onSaved} />}
      </div>
    </div>
  );
}

/** The artifacts a set can link: ECMAScript/GCV sets take resources of their kind; every other set takes policies. */
function candidates(outline: Outline | null, driver: string, bone: FishboneBone): ArtifactNode[] {
  if (!outline) {
    return [];
  }
  const d = outline.drivers.find((x) => x.name === driver);
  const own = d ? [...d.policies.driver, ...d.policies.subscriber, ...d.policies.publisher, ...d.resources] : [];
  const all = [...own, ...outline.library.policies, ...outline.library.resources];
  const resourceKind = bone.key === "ecmascript" ? "ecmascript" : bone.key === "gcv" ? "gcv" : null;
  return all.filter((a) => (resourceKind ? a.kind === resourceKind : a.kind === "dirxml-script" || a.kind === "xslt" || a.kind === "schema-map"));
}

function SetPanel({ driver, bone, outline, onOpen, onClose, onSaved }: { driver: string; bone: FishboneBone; outline: Outline | null; onOpen: (path: string) => void; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const original = useMemo(() => bone.policies.map((p) => p.ref), [bone]);
  const [order, setOrder] = useState<string[]>(original);
  const [pick, setPick] = useState("");
  const [ops, setOps] = useState<OpCall[] | null>(null);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    bone.policies.forEach((p) => m.set(p.ref, p.name));
    candidates(outline, driver, bone).forEach((a) => m.set(a.path, a.name));
    return m;
  }, [bone, outline, driver]);
  const linkable = candidates(outline, driver, bone).filter((a) => !order.includes(a.path));
  const dirty = order.length !== original.length || order.some((r, i) => r !== original[i]);

  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= order.length) {
      return;
    }
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
  };

  const review = () => {
    const set = bone.key;
    const list: OpCall[] = [];
    const removed = original.filter((r) => !order.includes(r));
    const added = order.filter((r) => !original.includes(r));
    for (const path of removed) {
      list.push({ name: "policy.unlink", args: { path, driver, set }, label: `unlink ${names.get(path) ?? path} from ${bone.label}` });
    }
    for (const path of added) {
      list.push({ name: "policy.link", args: { path, driver, set, at: "last" }, label: `link ${names.get(path) ?? path} into ${bone.label}` });
    }
    // after those, the set reads: the kept members in their old order, then the new ones
    const expected = [...original.filter((r) => order.includes(r)), ...added];
    if (order.some((r, i) => r !== expected[i])) {
      list.push({ name: "policy.reorder", args: { driver, set, order: order.join("\n") }, label: `reorder ${bone.label}: ${order.map((r) => names.get(r) ?? r).join(" → ")}` });
    }
    setOps(list);
  };

  return (
    <aside className="setpanel" data-testid="set-panel">
      <div className="setpanel-head">
        <div>
          <div className="kicker">{bone.channel === "publisher" || bone.channel === "subscriber" ? `${bone.channel} channel` : "driver"} policy set</div>
          <h3>{bone.label}</h3>
        </div>
        <button className="linkish" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      {order.length === 0 ? (
        <p className="muted small">Nothing is linked here yet.</p>
      ) : (
        <ol className="setorder">
          {order.map((ref, i) => (
            <li key={ref} data-testid="set-member">
              <button className="linkish name" onClick={() => onOpen(ref)} title={ref}>
                {names.get(ref) ?? ref}
              </button>
              <span className="ordbtns">
                <button className="small" disabled={i === 0} onClick={() => move(i, -1)} title="Earlier" data-testid="set-up">
                  ▲
                </button>
                <button className="small" disabled={i === order.length - 1} onClick={() => move(i, 1)} title="Later" data-testid="set-down">
                  ▼
                </button>
                <button className="small" onClick={() => setOrder(order.filter((r) => r !== ref))} title="Unlink (the policy stays in the tree)" data-testid="set-unlink">
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="addrow">
        <select value={pick} onChange={(e) => setPick(e.target.value)} data-testid="set-pick">
          <option value="">link an existing {bone.key === "ecmascript" || bone.key === "gcv" ? "resource" : "policy"}…</option>
          {linkable.map((a) => (
            <option key={a.path} value={a.path}>
              {a.path.startsWith("library/") ? `Library: ${a.name}` : a.name}
            </option>
          ))}
        </select>
        <button
          className="small"
          disabled={!pick}
          onClick={() => {
            setOrder([...order, pick]);
            setPick("");
          }}
          data-testid="set-link"
        >
          Link
        </button>
      </div>
      <div className="addrow">
        <button className="primary" disabled={!dirty} onClick={review} data-testid="set-review">
          Review changes
        </button>
        <button disabled={!dirty} onClick={() => setOrder(original)}>
          Reset
        </button>
      </div>
      <p className="muted small">The engine runs a set's policies top to bottom. A new policy is made from the + beside the driver and linked here on creation.</p>
      {ops && (
        <ReviewDialog
          title={`${bone.label} on ${driver}`}
          ops={ops}
          onClose={() => setOps(null)}
          onApplied={() => {
            setOps(null);
            void onSaved();
          }}
        />
      )}
    </aside>
  );
}
