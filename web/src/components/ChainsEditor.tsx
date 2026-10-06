import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { FishboneBone, FishboneModel } from "../fishbone/types";
import type { Pending } from "../pending";
import type { ArtifactNode, OpCall } from "../types";

interface Props {
  driver: string;
  revision: string;
  pending: Pending;
  /** Every artifact that could be linked into a policy set of this driver. */
  linkable: ArtifactNode[];
  onOpen: (path: string) => void;
}

/**
 * The policy sets of a driver, each as an ordered list: drag (or the arrows) to reorder, unlink,
 * or link another policy in. The ops are derived from the difference between the order the tree
 * has and the order shown: `policy.unlink`, `policy.link`, then one `policy.reorder`.
 */
export function ChainsEditor({ driver, revision, pending, linkable, onOpen }: Props) {
  const [model, setModel] = useState<FishboneModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desired, setDesired] = useState<Record<string, string[]>>({});
  const [drag, setDrag] = useState<{ bone: string; index: number } | null>(null);
  const [toLink, setToLink] = useState<Record<string, string>>({});

  useEffect(() => {
    let gone = false;
    api
      .fishbone(driver)
      .then((m) => {
        if (!gone) {
          setModel(m);
          setError(null);
        }
      })
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [driver, revision]);

  const bones: FishboneBone[] = useMemo(() => (model ? [...model.publisher, ...model.subscriber, ...model.spine, ...model.resources] : []), [model]);

  // when nothing is pending for a set, show the tree's order (also after a save or an outside edit)
  useEffect(() => {
    setDesired((d) => {
      const next: Record<string, string[]> = {};
      for (const b of bones) {
        const key = `chain:${b.key}`;
        next[b.key] = pending.ops.some((o) => o.key?.startsWith(key)) && d[b.key] ? d[b.key]! : b.policies.map((p) => p.ref);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bones, pending.ops.length === 0]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!model) {
    return <p className="muted pad">Loading the policy sets…</p>;
  }

  const nameOf = (ref: string) => linkable.find((a) => a.path === ref)?.name ?? ref.split("/").pop() ?? ref;

  const stage = (bone: FishboneBone, order: string[]) => {
    setDesired((d) => ({ ...d, [bone.key]: order }));
    const original = bone.policies.map((p) => p.ref);
    const base = `chain:${bone.key}`;
    // withdraw what was staged for this set, then stage the difference afresh
    for (const o of pending.ops.filter((x) => x.key?.startsWith(base))) {
      if (o.key) {
        pending.put(o.key, null);
      }
    }
    const ops: OpCall[] = [];
    for (const ref of original.filter((r) => !order.includes(r))) {
      ops.push({ name: "policy.unlink", args: { path: ref, driver, set: bone.key }, label: `${bone.label}: unlink ${nameOf(ref)}`, key: `${base}:unlink:${ref}` });
    }
    for (const ref of order.filter((r) => !original.includes(r))) {
      ops.push({ name: "policy.link", args: { path: ref, driver, set: bone.key }, label: `${bone.label}: link ${nameOf(ref)}`, key: `${base}:link:${ref}` });
    }
    const afterLinks = [...original.filter((r) => order.includes(r)), ...order.filter((r) => !original.includes(r))];
    if (order.length > 1 && order.join("\n") !== afterLinks.join("\n")) {
      ops.push({ name: "policy.reorder", args: { driver, set: bone.key, order: order.join("\n") }, label: `${bone.label}: order ${order.map(nameOf).join(" → ")}`, key: `${base}:order` });
    }
    for (const o of ops) {
      pending.put(o.key!, o);
    }
  };

  const move = (bone: FishboneBone, from: number, to: number) => {
    const order = [...(desired[bone.key] ?? [])];
    if (to < 0 || to >= order.length || from === to) {
      return;
    }
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item!);
    stage(bone, order);
  };

  const group = (title: string, list: FishboneBone[]) => (
    <section className="chaingroup">
      <h3>{title}</h3>
      <div className="chains">
        {list.map((bone) => {
          const order = desired[bone.key] ?? bone.policies.map((p) => p.ref);
          const changed = pending.ops.some((o) => o.key?.startsWith(`chain:${bone.key}`));
          const candidates = linkable.filter((a) => !order.includes(a.path));
          return (
            <div key={bone.key} className={changed ? "chain changed" : "chain"}>
              <header>
                <strong>{bone.label}</strong>
                <span className="count">{order.length}</span>
              </header>
              <ol
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (drag && drag.bone === bone.key) {
                    move(bone, drag.index, order.length - 1);
                  }
                  setDrag(null);
                }}
              >
                {order.length === 0 && <li className="muted small empty">no policies</li>}
                {order.map((ref, i) => (
                  <li
                    key={ref}
                    draggable
                    onDragStart={() => setDrag({ bone: bone.key, index: i })}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.stopPropagation();
                      if (drag && drag.bone === bone.key) {
                        move(bone, drag.index, i);
                      }
                      setDrag(null);
                    }}
                    className={drag?.bone === bone.key && drag.index === i ? "dragging" : ""}
                  >
                    <span className="grip" title="Drag to reorder">
                      ⋮⋮
                    </span>
                    <button className="link grow" onClick={() => onOpen(ref)} title={ref}>
                      {nameOf(ref)}
                    </button>
                    <button className="mini" disabled={i === 0} onClick={() => move(bone, i, i - 1)} title="Earlier">
                      ↑
                    </button>
                    <button className="mini" disabled={i === order.length - 1} onClick={() => move(bone, i, i + 1)} title="Later">
                      ↓
                    </button>
                    <button className="mini danger" onClick={() => stage(bone, order.filter((r) => r !== ref))} title="Unlink from this set (the policy itself stays)">
                      ×
                    </button>
                  </li>
                ))}
              </ol>
              <div className="addrow tight">
                <select value={toLink[bone.key] ?? ""} onChange={(e) => setToLink({ ...toLink, [bone.key]: e.target.value })}>
                  <option value="">link a policy…</option>
                  {candidates.map((a) => (
                    <option key={a.path} value={a.path}>
                      {a.path}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!toLink[bone.key]}
                  onClick={() => {
                    stage(bone, [...order, toLink[bone.key]!]);
                    setToLink({ ...toLink, [bone.key]: "" });
                  }}
                >
                  Link
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="pad">
      <p className="muted small">The engine runs a set's policies top to bottom. Drag a policy, or use the arrows, to change the order; × unlinks it from the set without deleting it.</p>
      {group("Publisher channel (application → Identity Vault)", model.publisher)}
      {group("Subscriber channel (Identity Vault → application)", model.subscriber)}
      {group("Shared", model.spine)}
      {group("Driver level", model.resources)}
    </div>
  );
}
