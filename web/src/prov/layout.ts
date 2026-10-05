/**
 * Lay a workflow out left to right: each activity in the column after its furthest
 * predecessor, columns ordered to keep links short. Links that go backwards (a loop to an
 * earlier activity) do not take part in the layering; they are drawn as they are.
 */
export interface LaidOut {
  nodes: Record<string, { x: number; y: number; layer: number }>;
  width: number;
  height: number;
  /** "from>to" of each link that points back to an earlier activity. */
  back: Set<string>;
}

export const NODE_W = 150;
export const NODE_H = 46;
const GAP_X = 70;
const GAP_Y = 26;

export function layout(ids: string[], links: { from: string; to: string }[], startId?: string): LaidOut {
  const out = new Map<string, string[]>();
  const known = new Set(ids);
  for (const id of ids) {
    out.set(id, []);
  }
  for (const l of links) {
    if (known.has(l.from) && known.has(l.to) && l.from !== l.to && !out.get(l.from)!.includes(l.to)) {
      out.get(l.from)!.push(l.to);
    }
  }
  // depth-first from the start (then from anything not reached) finds the links that close a loop
  const back = new Set<string>();
  const state = new Map<string, number>();
  const order: string[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const t of out.get(id)!) {
      if (state.get(t) === 1) {
        back.add(`${id}>${t}`);
      } else if (!state.has(t)) {
        visit(t);
      }
    }
    state.set(id, 2);
    order.unshift(id);
  };
  const roots = [...(startId && known.has(startId) ? [startId] : []), ...ids];
  for (const id of roots) {
    if (!state.has(id)) {
      visit(id);
    }
  }
  // longest path over what is left, in topological order
  const layer = new Map<string, number>();
  for (const id of order) {
    if (!layer.has(id)) {
      layer.set(id, 0);
    }
    for (const t of out.get(id)!) {
      if (!back.has(`${id}>${t}`)) {
        layer.set(t, Math.max(layer.get(t) ?? 0, layer.get(id)! + 1));
      }
    }
  }
  const columns: string[][] = [];
  for (const id of order) {
    const l = layer.get(id)!;
    (columns[l] ??= []).push(id);
  }
  for (let i = 0; i < columns.length; i++) {
    columns[i] ??= [];
  }
  // two sweeps of ordering each column by where its predecessors sit
  const incoming = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, []);
  }
  for (const [from, tos] of out) {
    for (const t of tos) {
      if (!back.has(`${from}>${t}`)) {
        incoming.get(t)!.push(from);
      }
    }
  }
  const row = new Map<string, number>();
  columns.forEach((c) => c.forEach((id, i) => row.set(id, i)));
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let l = 1; l < columns.length; l++) {
      const col = columns[l]!;
      const weight = (id: string) => {
        const ps = incoming.get(id)!;
        return ps.length === 0 ? row.get(id)! : ps.reduce((a, p) => a + row.get(p)!, 0) / ps.length;
      };
      const sorted = col.map((id, i) => ({ id, w: weight(id), i })).sort((a, b) => a.w - b.w || a.i - b.i);
      sorted.forEach((s, i) => {
        col[i] = s.id;
        row.set(s.id, i);
      });
    }
  }
  const tallest = Math.max(1, ...columns.map((c) => c.length));
  const height = tallest * NODE_H + (tallest - 1) * GAP_Y;
  const nodes: LaidOut["nodes"] = {};
  columns.forEach((col, l) => {
    const colHeight = col.length * NODE_H + (col.length - 1) * GAP_Y;
    col.forEach((id, i) => {
      nodes[id] = { x: l * (NODE_W + GAP_X), y: (height - colHeight) / 2 + i * (NODE_H + GAP_Y), layer: l };
    });
  });
  return { nodes, width: Math.max(1, columns.length) * (NODE_W + GAP_X) - GAP_X, height, back };
}
