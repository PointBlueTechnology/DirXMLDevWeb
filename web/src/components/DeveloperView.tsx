import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { EnvPicker, useEnvironment } from "../env";
import type { DevNode, DriverState, Selection } from "../types";

/**
 * The whole driver set as one tree, the way Designer's outline reads in the Developer
 * perspective (#32): the set's configuration and library, each
 * driver's configuration, its channels with the policy sets in engine order and the policies in
 * linkage order, resources, entitlements, forms, PRDs. Every node opens what the sidebar would;
 * a filter keeps the matching nodes and their ancestors; the driver rows can carry the live
 * state of the chosen environment.
 */
export function DeveloperView({ revision, onSelect }: { revision: string; onSelect: (s: Selection) => void }) {
  const [root, setRoot] = useState<DevNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [allOpen, setAllOpen] = useState<boolean | null>(null);
  const { envs, env, setEnv } = useEnvironment();
  const [showState, setShowState] = useState(false);
  const [states, setStates] = useState<Record<string, DriverState> | null>(null);
  const envReady = !!envs?.find((e) => e.name === env && e.ready);

  useEffect(() => {
    api
      .developer()
      .then((d) => (setRoot(d.root), setError(null)))
      .catch((e: Error) => setError(e.message));
  }, [revision]);

  useEffect(() => {
    if (!showState || !env || !envReady) {
      setStates(null);
      return;
    }
    let live = true;
    api.vault
      .status(env)
      .then((s) => {
        if (!live) {
          return;
        }
        const m: Record<string, DriverState> = {};
        for (const d of s.drivers) {
          m[d.name] = d;
        }
        setStates(m);
      })
      .catch(() => live && setStates(null));
    return () => {
      live = false;
    };
  }, [showState, env, envReady, revision]);

  const q = filter.trim().toLowerCase();
  /** With a filter: the nodes that match, or have a matching descendant. */
  const visible = useMemo(() => {
    if (!root || !q) {
      return null;
    }
    const keep = new Set<string>();
    const walk = (n: DevNode): boolean => {
      let hit = n.label.toLowerCase().includes(q) || (n.shimClass ?? "").toLowerCase().includes(q) || (n.typeName ?? "").toLowerCase().includes(q);
      for (const c of n.children ?? []) {
        if (walk(c)) {
          hit = true;
        }
      }
      if (hit) {
        keep.add(n.id);
      }
      return hit;
    };
    walk(root);
    return keep;
  }, [root, q]);

  const isOpen = (n: DevNode, depth: number) => {
    if (open[n.id] !== undefined) {
      return open[n.id]!;
    }
    if (q) {
      return true;
    }
    if (allOpen !== null) {
      return allOpen;
    }
    return depth < 2 || n.kind === "driver";
  };

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!root) {
    return <p className="muted pad">Loading…</p>;
  }

  const row = (n: DevNode, depth: number): JSX.Element | null => {
    if (visible && !visible.has(n.id)) {
      return null;
    }
    const kids = n.children ?? [];
    const folder = n.children !== undefined;
    const opened = folder && isOpen(n, depth);
    const st = n.driver ? states?.[n.driver] : undefined;
    const sel = n.select as Selection | undefined;
    return (
      <li key={n.id} className={"devnode kind-" + n.kind + (n.unresolved ? " unresolved" : "")}>
        <div className="devrow" style={{ paddingLeft: depth * 18 }}>
          {folder ? (
            <button className="twisty" onClick={() => setOpen({ ...open, [n.id]: !opened })} aria-label={opened ? "collapse" : "expand"} data-testid={"dev-twisty-" + n.id}>
              {opened ? "▾" : "▸"}
            </button>
          ) : (
            <span className="twisty" />
          )}
          {n.kind === "driver" && n.icon && n.driver && <img className="devicon" src={api.driverIconUrl(n.driver, revision)} alt="" width={16} height={16} />}
          <span className={"kindtag kind-" + n.kind}>{tag(n.kind)}</span>
          {sel ? (
            <button className="leaf" onClick={() => onSelect(sel)} title={n.shimClass ?? undefined} data-testid={"dev-open-" + n.id}>
              {n.label}
            </button>
          ) : (
            <span className="devlabel">{n.label}</span>
          )}
          {n.kind === "driver" && n.typeName && n.typeName !== n.label && <span className="muted small"> {n.typeName}</span>}
          {n.unresolved && <span className="pill warn">unresolved</span>}
          {st && <span className={"pill " + (st.state.toLowerCase().includes("running") ? "ok" : st.state.toLowerCase().includes("disabled") ? "err" : "")}>{st.state}</span>}
          {folder && n.count !== undefined && <span className="muted small count">{n.count}</span>}
        </div>
        {opened && kids.length > 0 && <ul className="devkids">{kids.map((c) => row(c, depth + 1))}</ul>}
        {opened && kids.length === 0 && <div className="muted small" style={{ paddingLeft: depth * 18 + 40 }}>empty</div>}
      </li>
    );
  };

  return (
    <div className="view developer" data-testid="developer">
      <div className="viewhead">
        <div>
          <div className="kicker">Driver set</div>
          <h2>Developer</h2>
        </div>
        <span className="pill">{root.count} items</span>
        <span className="spacer" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter by name, type or shim…" spellCheck={false} style={{ width: 220 }} data-testid="dev-filter" />
        <button onClick={() => (setAllOpen(true), setOpen({}))} data-testid="dev-expand">
          Expand all
        </button>
        <button onClick={() => (setAllOpen(false), setOpen({}))} data-testid="dev-collapse">
          Collapse all
        </button>
        {envs && envs.length > 0 && <EnvPicker envs={envs} env={env} setEnv={setEnv} testid="dev-env" />}
        <label className="checkchip" title="The state of each driver in the chosen environment (one read of the vault)">
          <input type="checkbox" checked={showState} onChange={(e) => setShowState(e.target.checked)} disabled={!envReady} data-testid="dev-state" /> show state
        </label>
      </div>
      <div className="pad scroll">
        <ul className="devtree">{row(root, 0)}</ul>
      </div>
    </div>
  );
}

function tag(kind: string): string {
  switch (kind) {
    case "driverset":
      return "SET";
    case "driver":
      return "DRV";
    case "channel":
      return "CH";
    case "policyset":
      return "PS";
    case "folder":
      return "";
    case "file":
      return "XML";
    case "config":
      return "CFG";
    case "gcv":
      return "GCV";
    case "schema":
      return "S";
    case "overrides":
      return "ENV";
    case "filter":
      return "FLT";
    case "entitlement":
      return "ENT";
    case "form":
      return "FORM";
    case "prd":
      return "PRD";
    case "ecmascript":
      return "JS";
    case "mapping-table":
      return "TBL";
    case "xslt":
      return "XSL";
    default:
      return kind.slice(0, 3).toUpperCase();
  }
}
