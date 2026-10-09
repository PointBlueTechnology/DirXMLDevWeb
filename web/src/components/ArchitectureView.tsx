import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { EnvPicker, useEnvironment } from "../env";
import type { ArchApplication, Architecture, DriverState, Selection } from "../types";

/**
 * The driver set as Designer's Modeler draws it in Architect mode (#32, docs/architecture-view.md):
 * the Identity Vault in the centre with its driver set, one application per driver in two
 * columns with the driver's own icon and its application type's name, the driver drawn as a
 * badge on the connector, the drivers that serve the vault itself beneath it. Hover for the
 * driver's facts, click for its flow or configuration; a live overlay colours the badges by the
 * driver's state in the chosen environment; the picture exports as a self-contained SVG or PNG.
 */

// ---- layout -----------------------------------------------------------------------------------

const L = {
  cardW: 300,
  cardH: 56,
  rowGap: 24,
  colGap: 110, // card edge to vault edge
  vaultW: 240,
  vaultMinH: 360,
  top: 40,
  side: 40,
  belowGap: 44,
  smallW: 150,
  smallH: 52,
  smallGap: 14,
  badgeR: 11,
};

export interface ArchLayout {
  width: number;
  height: number;
  vault: { x: number; y: number; w: number; h: number };
  left: { app: ArchApplication; x: number; y: number }[];
  right: { app: ArchApplication; x: number; y: number }[];
  below: { app: ArchApplication; x: number; y: number }[];
}

/** Applications in two balanced columns around the vault, sorted by name and alternated; vault-only drivers in a row beneath. */
export function archLayout(apps: ArchApplication[]): ArchLayout {
  const external = apps.filter((a) => !a.vaultOnly).sort((a, b) => label(a).localeCompare(label(b)));
  const below = apps.filter((a) => a.vaultOnly).sort((a, b) => label(a).localeCompare(label(b)));
  const left: ArchApplication[] = [];
  const right: ArchApplication[] = [];
  external.forEach((a, i) => (i % 2 === 0 ? left : right).push(a));
  const rows = Math.max(left.length, right.length, 1);
  const colH = rows * L.cardH + (rows - 1) * L.rowGap;
  const vaultH = Math.max(L.vaultMinH, colH);
  const vaultX = L.side + L.cardW + L.colGap;
  const vault = { x: vaultX, y: L.top, w: L.vaultW, h: vaultH };
  const rightX = vaultX + L.vaultW + L.colGap;
  const place = (col: ArchApplication[], x: number) =>
    col.map((app, i) => ({ app, x, y: L.top + (vaultH - colH) / 2 + i * (L.cardH + L.rowGap) }));
  const belowY = L.top + vaultH + L.belowGap;
  const belowTotal = below.length * L.smallW + Math.max(0, below.length - 1) * L.smallGap;
  const belowStart = vaultX + L.vaultW / 2 - belowTotal / 2;
  const belowPlaced = below.map((app, i) => ({ app, x: belowStart + i * (L.smallW + L.smallGap), y: belowY }));
  const width = rightX + L.cardW + L.side;
  const height = (below.length > 0 ? belowY + L.smallH : L.top + vaultH) + 50;
  return { width: Math.max(width, belowStart + belowTotal + L.side), height, vault, left: place(left, L.side), right: place(right, rightX), below: belowPlaced };
}

export function label(a: ArchApplication): string {
  return a.typeName ?? a.driver;
}

/** The styles the picture needs, embedded in the SVG so an export looks the same on its own. */
const CSS = `
.arch-svg { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
.arch-svg .app { fill: var(--surface, #fff); stroke: var(--border, #d9dde3); stroke-width: 1.2; }
.arch-svg .app-g { cursor: pointer; }
.arch-svg .app-g:hover .app, .arch-svg .app-g.selected .app { stroke: var(--accent, #2f6fd0); stroke-width: 2; }
.arch-svg .app-g.dim { opacity: 0.22; }
.arch-svg .app-name { font-size: 13px; font-weight: 600; fill: var(--text, #1f2328); }
.arch-svg .drv-name { font-size: 11px; fill: var(--muted, #6b7280); }
.arch-svg .vault { fill: color-mix(in srgb, var(--accent, #2f6fd0) 10%, var(--surface, #fff)); stroke: var(--accent, #2f6fd0); stroke-width: 1.6; }
.arch-svg .vault-title { font-size: 15px; font-weight: 700; fill: var(--accent, #2f6fd0); }
.arch-svg .vault-sub { font-size: 11px; fill: var(--muted, #6b7280); }
.arch-svg .band { fill: var(--accent, #2f6fd0); }
.arch-svg .band-text { font-size: 12px; font-weight: 600; fill: var(--accent-text, #fff); }
.arch-svg .conn { stroke: var(--muted, #9aa3ad); stroke-width: 1.4; fill: none; opacity: 0.8; }
.arch-svg .badge { fill: var(--surface, #fff); stroke: var(--muted, #9aa3ad); stroke-width: 1.2; cursor: pointer; }
.arch-svg .badge-g:hover .badge { stroke: var(--accent, #2f6fd0); stroke-width: 2; }
.arch-svg .dot { stroke: var(--surface, #fff); stroke-width: 1.2; }
.arch-svg .dot.running { fill: var(--ok, #1f8a4c); }
.arch-svg .dot.stopped { fill: var(--muted, #9aa3ad); }
.arch-svg .dot.disabled { fill: var(--err, #c0392b); }
.arch-svg .dot.other { fill: var(--warn, #b7791f); }
.arch-svg .generic { fill: var(--surface-2, #f0f2f5); stroke: var(--border, #d9dde3); }
.arch-svg .generic-text { font-size: 11px; font-weight: 700; fill: var(--muted, #6b7280); }
.arch-svg .legend { font-size: 11px; fill: var(--muted, #6b7280); }
`;

function stateClass(s: string | undefined): string {
  if (!s) {
    return "";
  }
  const v = s.toLowerCase();
  return v.includes("running") ? "running" : v.includes("disabled") ? "disabled" : v.includes("stopped") ? "stopped" : "other";
}

// ---- the view ---------------------------------------------------------------------------------

export function ArchitectureView({ revision, onSelect }: { revision: string; onSelect: (s: Selection) => void }) {
  const [data, setData] = useState<Architecture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { envs, env, setEnv } = useEnvironment();
  const [showState, setShowState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("idmweb.arch.state") === "1";
    } catch {
      return false;
    }
  });
  const [states, setStates] = useState<Record<string, DriverState> | null>(null);
  const [stateNote, setStateNote] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [exporting, setExporting] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const envReady = !!envs?.find((e) => e.name === env && e.ready);

  useEffect(() => {
    api
      .architecture()
      .then((a) => (setData(a), setError(null)))
      .catch((e: Error) => setError(e.message));
  }, [revision]);

  useEffect(() => {
    try {
      localStorage.setItem("idmweb.arch.state", showState ? "1" : "0");
    } catch {
      // per-browser convenience only
    }
    if (!showState || !env || !envReady) {
      setStates(null);
      setStateNote(null);
      return;
    }
    let live = true;
    setStateNote("reading driver states…");
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
        setStateNote(s.ok ? `${s.drivers.length} driver states from ${env}` : s.text);
      })
      .catch((e: Error) => live && (setStates(null), setStateNote(e.message)));
    return () => {
      live = false;
    };
  }, [showState, env, envReady, revision]);

  const layout = useMemo(() => (data ? archLayout(data.applications) : null), [data]);
  const q = filter.trim().toLowerCase();
  const matches = (a: ArchApplication) => !q || a.driver.toLowerCase().includes(q) || label(a).toLowerCase().includes(q) || (a.shimClass ?? "").toLowerCase().includes(q);

  const exportSvg = async (png: boolean) => {
    const node = svgRef.current;
    if (!node || !data) {
      return;
    }
    setExporting(png ? "png" : "svg");
    try {
      const clone = node.cloneNode(true) as SVGSVGElement;
      // the page's colour tokens, resolved, so the file looks the same on its own
      const cs = getComputedStyle(document.documentElement);
      const tokens = ["--surface", "--surface-2", "--border", "--text", "--muted", "--accent", "--accent-text", "--ok", "--warn", "--err"].map((t) => `${t}: ${cs.getPropertyValue(t).trim() || "initial"};`).join(" ");
      const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
      style.textContent = `.arch-svg { ${tokens} } ${CSS}`;
      clone.insertBefore(style, clone.firstChild);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
      clone.style.transform = "";
      // icons as data URLs, fetched with the session
      const images = Array.from(clone.querySelectorAll("image"));
      await Promise.all(
        images.map(async (img) => {
          const href = img.getAttribute("href");
          if (!href) {
            return;
          }
          try {
            const res = await fetch(href, { credentials: "same-origin", headers: api.authHeaders() });
            if (!res.ok) {
              img.remove();
              return;
            }
            const blob = await res.blob();
            const dataUrl = await new Promise<string>((resolve) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result));
              r.readAsDataURL(blob);
            });
            img.setAttribute("href", dataUrl);
          } catch {
            img.remove();
          }
        }),
      );
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("width", "100%");
      bg.setAttribute("height", "100%");
      bg.setAttribute("fill", cs.getPropertyValue("--surface-2").trim() || "#f0f2f5");
      clone.insertBefore(bg, style.nextSibling);
      const xml = new XMLSerializer().serializeToString(clone);
      const name = `${data.driverSet.name || "driver-set"}-architecture`;
      if (!png) {
        download(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }), name + ".svg");
        return;
      }
      const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
      try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("the picture could not be rendered"));
          img.src = url;
        });
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = (layout?.width ?? 1200) * scale;
        canvas.height = (layout?.height ?? 800) * scale;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (blob) {
          download(blob, name + ".png");
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(null);
    }
  };

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data || !layout) {
    return <p className="muted pad">Loading…</p>;
  }
  const ds = data.driverSet;
  const v = layout.vault;
  const edge = (side: "left" | "right") => (side === "left" ? v.x : v.x + v.w);

  const card = (p: { app: ArchApplication; x: number; y: number }, side: "left" | "right") => {
    const a = p.app;
    const dim = !matches(a);
    const cy = p.y + L.cardH / 2;
    const fromX = side === "left" ? p.x + L.cardW : p.x;
    const toX = edge(side);
    const midX = (fromX + toX) / 2;
    const vaultY = Math.min(Math.max(cy, v.y + 40), v.y + v.h - 40);
    const st = states?.[a.driver];
    const tip = `${a.driver}\n${a.shimClass ?? "no shim class"}\n${a.counts.policies} policies · ${a.counts.entitlements} entitlements · ${a.counts.resources} resources${a.counts.forms + a.counts.prds > 0 ? ` · ${a.counts.forms} forms · ${a.counts.prds} PRDs` : ""}${st ? `\n${st.state}${st.cacheSize ? ` · cache ${st.cacheSize}` : ""}` : ""}`;
    return (
      <g key={a.driver}>
        <path className="conn" d={`M${fromX},${cy} C${midX},${cy} ${midX},${vaultY} ${toX},${vaultY}`} />
        <g className={"app-g" + (dim ? " dim" : "") + (selected === a.driver ? " selected" : "")} onClick={() => (setSelected(a.driver), onSelect({ type: "flow", driver: a.driver }))} data-testid={"arch-app-" + a.driver}>
          <title>{tip}</title>
          <rect className="app" x={p.x} y={p.y} width={L.cardW} height={L.cardH} rx={8} />
          {icon(a, p.x + 10, p.y + 12, 32, data.revision)}
          <text className="app-name" x={p.x + 52} y={p.y + 24}>
            {label(a)}
          </text>
          <text className="drv-name" x={p.x + 52} y={p.y + 42}>
            {a.typeName && a.typeName !== a.driver ? `${a.driver} · ` : ""}
            {shortShim(a.shimClass)}
          </text>
        </g>
        <g className={"badge-g" + (dim ? " dim" : "")} onClick={() => onSelect({ type: "config", driver: a.driver })} data-testid={"arch-badge-" + a.driver}>
          <title>{`${a.driver}: configuration${st ? ` · ${st.state}` : ""}`}</title>
          <circle className="badge" cx={midX} cy={(cy + vaultY) / 2} r={L.badgeR} />
          {st && <circle className={"dot " + stateClass(st.state)} cx={midX + 8} cy={(cy + vaultY) / 2 - 8} r={4} />}
        </g>
      </g>
    );
  };

  const small = (p: { app: ArchApplication; x: number; y: number }) => {
    const a = p.app;
    const dim = !matches(a);
    const cx = p.x + L.smallW / 2;
    const st = states?.[a.driver];
    return (
      <g key={a.driver}>
        <path className="conn" d={`M${cx},${v.y + v.h} L${cx},${p.y}`} />
        <g className={"badge-g" + (dim ? " dim" : "")} onClick={() => onSelect({ type: "config", driver: a.driver })}>
          <title>{`${a.driver}: configuration${st ? ` · ${st.state}` : ""}`}</title>
          <circle className="badge" cx={cx} cy={(v.y + v.h + p.y) / 2} r={9} />
          {st && <circle className={"dot " + stateClass(st.state)} cx={cx + 6} cy={(v.y + v.h + p.y) / 2 - 6} r={3.5} />}
        </g>
        <g className={"app-g" + (dim ? " dim" : "") + (selected === a.driver ? " selected" : "")} onClick={() => (setSelected(a.driver), onSelect({ type: "flow", driver: a.driver }))} data-testid={"arch-app-" + a.driver}>
          <title>{`${a.driver}\n${a.shimClass ?? ""}\n${a.counts.policies} policies${a.counts.forms + a.counts.prds > 0 ? ` · ${a.counts.forms} forms · ${a.counts.prds} PRDs` : ""}`}</title>
          <rect className="app" x={p.x} y={p.y} width={L.smallW} height={L.smallH} rx={8} />
          {icon(a, p.x + 8, p.y + 11, 28, data.revision)}
          <text className="app-name" x={p.x + 44} y={p.y + 22} style={{ fontSize: 12 }}>
            {fit(label(a), 15)}
          </text>
          <text className="drv-name" x={p.x + 44} y={p.y + 39}>
            {fit(a.driver, 17)}
          </text>
        </g>
      </g>
    );
  };

  return (
    <div className="view architecture" data-testid="architecture">
      <div className="viewhead">
        <div>
          <div className="kicker">Driver set</div>
          <h2>Architecture</h2>
        </div>
        <span className="pill">
          {ds.drivers} driver{ds.drivers === 1 ? "" : "s"} · {layout.left.length + layout.right.length} applications
        </span>
        <span className="spacer" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter by name or shim…" spellCheck={false} style={{ width: 200 }} data-testid="arch-filter" />
        {envs && envs.length > 0 && <EnvPicker envs={envs} env={env} setEnv={setEnv} testid="arch-env" />}
        <label className="checkchip" title="Colour each driver by its state in the chosen environment (one read of the vault)">
          <input type="checkbox" checked={showState} onChange={(e) => setShowState(e.target.checked)} disabled={!envReady} data-testid="arch-state" /> show state
        </label>
        <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} title="Zoom in">
          +
        </button>
        <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))} title="Zoom out">
          −
        </button>
        <button onClick={() => setZoom(1)} title="Fit the picture to the page">
          Fit
        </button>
        <button disabled={exporting !== null} onClick={() => void exportSvg(false)} title="The picture as a self-contained SVG, styles and icons included" data-testid="arch-export-svg">
          {exporting === "svg" ? "Writing…" : "Download SVG"}
        </button>
        <button disabled={exporting !== null} onClick={() => void exportSvg(true)} title="The picture as a PNG at twice the size, for a slide or a document" data-testid="arch-export-png">
          {exporting === "png" ? "Rendering…" : "Download PNG"}
        </button>
      </div>
      {stateNote && <div className="muted small pad-x">{stateNote}</div>}
      <div className="pad scroll archcanvas">
        <svg ref={svgRef} className="arch-svg" width={layout.width * zoom} height={layout.height * zoom} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="Architecture: the Identity Vault and the applications its drivers connect">
          <style>{CSS}</style>
          <rect className="vault" x={v.x} y={v.y} width={v.w} height={v.h} rx={14} />
          <g transform={`translate(${v.x + 18},${v.y + 20})`}>
            <path d="M3 10 L12 3 L21 10 Z M4 10 H20 V12 H4 Z M6 12 V20 M10 12 V20 M14 12 V20 M18 12 V20 M3 21 H21" fill="none" stroke="var(--accent, #2f6fd0)" strokeWidth={1.6} strokeLinejoin="round" />
          </g>
          <text className="vault-title" x={v.x + 48} y={v.y + 38}>
            Identity Vault
          </text>
          <text className="vault-sub" x={v.x + 18} y={v.y + 58}>
            {ds.dn ?? "no DN recorded"}
          </text>
          <rect className="band" x={v.x + 16} y={v.y + 74} width={v.w - 32} height={30} rx={6} />
          <text className="band-text" x={v.x + 28} y={v.y + 94}>
            {fit(ds.name, 26)}
          </text>
          <text className="vault-sub" x={v.x + 18} y={v.y + 126}>
            {ds.drivers} drivers · {ds.libraryItems} library items · {ds.packages} packages
          </text>
          {ds.servers.length > 0 && (
            <>
              <text className="vault-sub" x={v.x + 18} y={v.y + v.h - 20 - ds.servers.length * 16}>
                server{ds.servers.length === 1 ? "" : "s"}
              </text>
              {ds.servers.map((s, i) => (
                <text key={s.dn} className="vault-sub" x={v.x + 18} y={v.y + v.h - 20 - (ds.servers.length - 1 - i) * 16}>
                  {fit(s.name, 28)}
                  {s.primary ? " (primary)" : ""}
                </text>
              ))}
            </>
          )}
          {layout.left.map((p) => card(p, "left"))}
          {layout.right.map((p) => card(p, "right"))}
          {layout.below.map(small)}
          <g transform={`translate(${L.side},${layout.height - 14})`}>
            {states && (
              <>
                <circle className="dot running" cx={4} cy={-4} r={4} />
                <text className="legend" x={12} y={0}>
                  running
                </text>
                <circle className="dot stopped" cx={70} cy={-4} r={4} />
                <text className="legend" x={78} y={0}>
                  stopped
                </text>
                <circle className="dot disabled" cx={136} cy={-4} r={4} />
                <text className="legend" x={144} y={0}>
                  disabled
                </text>
              </>
            )}
            <text className="legend" x={states ? 210 : 0} y={0}>
              click an application: its policy flow · click a driver badge: its configuration · hover: shim, policies, entitlements{states ? ", state" : ""}
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}

function icon(a: ArchApplication, x: number, y: number, size: number, revision: string) {
  if (a.icon) {
    return <image href={api.driverIconUrl(a.driver, revision)} x={x} y={y} width={size} height={size} preserveAspectRatio="xMidYMid meet" />;
  }
  const initials = label(a)
    .split(/[\s-]+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <g>
      <rect className="generic" x={x} y={y} width={size} height={size} rx={6} />
      <text className="generic-text" x={x + size / 2} y={y + size / 2 + 4} textAnchor="middle">
        {initials}
      </text>
    </g>
  );
}

function shortShim(s: string | null): string {
  if (!s) {
    return "no shim class";
  }
  return s.length > 44 ? "…" + s.slice(-43) : s;
}

function fit(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}
