// The policy-flow fishbone, as SVG. Ported from the DirXMLDev VS Code extension
// (extensions/dirxmldev-visual/src/webview.ts) so both draw the same picture from the same model.
import type { FishboneBone, FishboneModel, FishbonePolicy } from "./types";

const POLICY_CHIP_W = 150;
const POLICY_CHIP_STEP = 26;
const POLICY_CHIP_H = 22;
/** Chip rect is drawn at centerY - POLICY_CHIP_TOP. */
const POLICY_CHIP_TOP = 10;

// Set boxes are BOX_W wide ("Command Transformation" at 13px semibold is ~160px) on ribs 180
// apart; chips (150) sit under them. The Input/Output column is a box-and-gutter past the last rib.
const BOX_W = 170;
const LAYOUT = {
  width: 1440,
  spineY: 320,
  ribXs: [250, 430, 610, 790, 970] as const,
  idvX: 80,
  appX: 1360,
  schemaX: 1170,
  ioX: 1170,
  ribOffset: 118,
  boxHalf: 22,
  stackFromBox: 36,
  resourceGap: 32,
  resourceTileH: 48,
  resourceStackFromTile: 64,
  bottomPad: 40,
};

export interface FishboneLayout {
  width: number;
  height: number;
  spineY: number;
  resourceY: number;
  ribXs: readonly number[];
}

/**
 * Resource-row Y sits below the lowest subscriber (and output) chip so Startup /
 * Shutdown tiles cannot cover Creation / Placement stacks. SVG height grows with
 * both that row and any GCV/ECMAScript chips hanging under it.
 */
export function fishboneLayout(model: FishboneModel): FishboneLayout {
  const { width, spineY, ribXs } = LAYOUT;
  const channelBottom = subscriberSideBottom(model);
  const resourceY = channelBottom + LAYOUT.resourceGap;
  let resourceBottom = resourceY + LAYOUT.resourceTileH;
  for (const bone of model.resources) {
    if (bone.policies.length === 0) {
      continue;
    }
    const lastCenter = resourceY + LAYOUT.resourceStackFromTile + (bone.policies.length - 1) * POLICY_CHIP_STEP;
    resourceBottom = Math.max(resourceBottom, lastCenter + (POLICY_CHIP_H - POLICY_CHIP_TOP));
  }
  return { width, height: resourceBottom + LAYOUT.bottomPad, spineY, resourceY, ribXs };
}

function subscriberSideBottom(model: FishboneModel): number {
  const { spineY, ribOffset, boxHalf } = LAYOUT;
  let bottom = spineY + ribOffset + boxHalf;
  for (const bone of model.subscriber) {
    bottom = Math.max(bottom, stackBottom(spineY, 1, bone));
  }
  const output = model.spine.find((b) => b.key === "output");
  if (output) {
    bottom = Math.max(bottom, stackBottom(spineY, 1, output));
  }
  return bottom;
}

function stackBottom(spineY: number, dir: number, bone: FishboneBone): number {
  const boxY = spineY + dir * LAYOUT.ribOffset;
  const boxEdge = boxY + dir * LAYOUT.boxHalf;
  if (bone.policies.length === 0) {
    return Math.max(boxY, boxEdge);
  }
  const startY = boxY + dir * LAYOUT.stackFromBox;
  const lastCenter = startY + dir * (bone.policies.length - 1) * POLICY_CHIP_STEP;
  return lastCenter + dir * (POLICY_CHIP_H - POLICY_CHIP_TOP);
}

export function renderSvg(model: FishboneModel): string {
  const { width, height, spineY, resourceY, ribXs } = fishboneLayout(model);
  const { idvX, appX, schemaX, ioX } = LAYOUT;

  const pubBones = model.publisher;
  const subBones = model.subscriber;
  const schema = model.spine.find((b) => b.key === "schema-mapping");
  const input = model.spine.find((b) => b.key === "input");
  const output = model.spine.find((b) => b.key === "output");

  const parts: string[] = [];
  parts.push(`<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Policy flow fishbone">`);
  parts.push(`<text class="channel-label pub" x="610" y="36" text-anchor="middle">Publisher channel</text>`);
  parts.push(`<text class="channel-label sub" x="610" y="${height - 16}" text-anchor="middle">Subscriber channel</text>`);

  // spine
  parts.push(`<line class="spine" x1="${idvX + 48}" y1="${spineY}" x2="${appX - 48}" y2="${spineY}"/>`);
  parts.push(endCap(idvX, spineY, "Identity Vault", "idv"));
  parts.push(endCap(appX, spineY, "Application", "app"));

  pubBones.forEach((bone, i) => {
    parts.push(rib(ribXs[i]!, spineY, -1, bone));
  });
  subBones.forEach((bone, i) => {
    parts.push(rib(ribXs[i]!, spineY, 1, bone));
  });

  if (input) {
    parts.push(ioBone(ioX, spineY, -1, input));
  }
  if (schema) {
    parts.push(spineBox(schemaX, spineY, schema.label, schema.id, "schema", schema.policies.length));
  }
  if (output) {
    parts.push(ioBone(ioX, spineY, 1, output));
  }

  // Filter + driver-level sets (ECMAScript, GCV, Startup, Shutdown) — off the channel ribs.
  let rx = 24;
  const ry = resourceY;
  if (model.filter) {
    const w = 130;
    parts.push(`<g class="bone filter" data-node="${escAttr(model.filter.id)}" tabindex="0">
      <rect x="${rx}" y="${ry}" width="${w}" height="${LAYOUT.resourceTileH}" rx="6"/>
      <text class="bone-title" x="${rx + 10}" y="${ry + 20}" text-anchor="start">Filter</text>
      <text class="count" x="${rx + 10}" y="${ry + 38}" text-anchor="start">driver-filter.xml</text>
    </g>`);
    rx += w + 12;
  }
  for (const bone of model.resources) {
    const w = 150;
    parts.push(resourceBone(rx, ry, w, bone));
    rx += w + 12;
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

function endCap(cx: number, cy: number, label: string, kind: string): string {
  return `<g class="end ${kind}">
    <rect x="${cx - 48}" y="${cy - 28}" width="96" height="56" rx="8"/>
    <text x="${cx}" y="${cy + 4}" text-anchor="middle">${esc(label)}</text>
  </g>`;
}

function spineBox(
  cx: number,
  cy: number,
  label: string,
  id: string,
  klass: string,
  count: number,
): string {
  const empty = count === 0 ? " empty" : "";
  return `<g class="bone spine-node ${klass}${empty}" data-node="${escAttr(id)}" tabindex="0">
    <title>${esc(label)}: ${count === 0 ? "nothing linked" : count === 1 ? "1 policy" : `${count} policies`}. Click to link, unlink or reorder.</title>
    <rect x="${cx - 62}" y="${cy - 22}" width="124" height="44" rx="6"/>
    <text class="bone-title" x="${cx}" y="${cy - 2}" text-anchor="middle">${esc(label)}</text>
    <text class="count" x="${cx}" y="${cy + 14}" text-anchor="middle">${count} polic${count === 1 ? "y" : "ies"}</text>
  </g>`;
}

function ioBone(cx: number, spineY: number, dir: number, bone: FishboneBone): string {
  // Input sits above the schema node toward the app; output below — Designer
  // places both transforms at the application end of the spine.
  const boxY = spineY + dir * LAYOUT.ribOffset;
  const empty = bone.policies.length === 0 ? " empty" : "";
  const klass = dir < 0 ? "pub" : "sub";
  return `<g class="bone ${klass}${empty}" data-node="${escAttr(bone.id)}" tabindex="0">
    <title>${esc(boneTip(bone))}</title>
    <line class="rib" x1="${cx}" y1="${spineY + dir * LAYOUT.boxHalf}" x2="${cx}" y2="${boxY - dir * LAYOUT.boxHalf}"/>
    <rect x="${cx - BOX_W / 2}" y="${boxY - LAYOUT.boxHalf}" width="${BOX_W}" height="${LAYOUT.boxHalf * 2}" rx="6"/>
    <text class="bone-title" x="${cx}" y="${boxY - 4}" text-anchor="middle">${esc(bone.label)}</text>
    <text class="count" x="${cx}" y="${boxY + 14}" text-anchor="middle">${bone.policies.length} polic${bone.policies.length === 1 ? "y" : "ies"}</text>
    ${policyStack(cx, boxY + dir * LAYOUT.stackFromBox, bone, dir)}
  </g>`;
}

function rib(cx: number, spineY: number, dir: number, bone: FishboneBone): string {
  const boxY = spineY + dir * LAYOUT.ribOffset;
  const empty = bone.policies.length === 0 ? " empty" : "";
  const klass = dir < 0 ? "pub" : "sub";
  return `<g class="bone ${klass}${empty}" data-node="${escAttr(bone.id)}" tabindex="0">
    <title>${esc(boneTip(bone))}</title>
    <line class="rib" x1="${cx}" y1="${spineY}" x2="${cx}" y2="${boxY - dir * LAYOUT.boxHalf}"/>
    <rect x="${cx - BOX_W / 2}" y="${boxY - LAYOUT.boxHalf}" width="${BOX_W}" height="${LAYOUT.boxHalf * 2}" rx="6"/>
    <text class="bone-title" x="${cx}" y="${boxY - 4}" text-anchor="middle">${esc(bone.label)}</text>
    <text class="count" x="${cx}" y="${boxY + 14}" text-anchor="middle">${bone.policies.length} polic${bone.policies.length === 1 ? "y" : "ies"}</text>
    ${policyStack(cx, boxY + dir * LAYOUT.stackFromBox, bone, dir)}
  </g>`;
}

function policyStack(cx: number, startY: number, bone: FishboneBone, dir: number): string {
  return bone.policies
    .map((p, i) => {
      const y = startY + dir * i * POLICY_CHIP_STEP;
      const w = POLICY_CHIP_W;
      const clipId = clipIdFor(p.id);
      const klass = p.unresolved ? "policy unresolved" : "policy";
      return `<g class="${klass}" data-node="${escAttr(p.id)}">
        <title>${esc(policyTip(p))}</title>
        <clipPath id="${escAttr(clipId)}"><rect x="${cx - w / 2}" y="${y - POLICY_CHIP_TOP}" width="${w}" height="${POLICY_CHIP_H}" rx="4"/></clipPath>
        <rect x="${cx - w / 2}" y="${y - POLICY_CHIP_TOP}" width="${w}" height="${POLICY_CHIP_H}" rx="4"/>
        <text x="${cx}" y="${y + 5}" text-anchor="middle" clip-path="url(#${escAttr(clipId)})">${esc(shortName(p))}</text>
      </g>`;
    })
    .join("\n");
}

function resourceBone(x: number, y: number, w: number, bone: FishboneBone): string {
  const empty = bone.policies.length === 0 ? " empty" : "";
  const cx = x + w / 2;
  const n = bone.policies.length;
  return `<g class="bone resource${empty}" data-node="${escAttr(bone.id)}" tabindex="0">
    <title>${esc(boneTip(bone))}</title>
    <rect x="${x}" y="${y}" width="${w}" height="${LAYOUT.resourceTileH}" rx="6"/>
    <text class="bone-title" x="${x + 10}" y="${y + 20}" text-anchor="start">${esc(bone.label)}</text>
    <text class="count" x="${x + 10}" y="${y + 38}" text-anchor="start">${n} ${n === 1 ? "item" : "items"}</text>
    ${policyStack(cx, y + LAYOUT.resourceStackFromTile, bone, 1)}
  </g>`;
}

/** The hover text of a policy chip: its full name and kind, then its description when it has one. */
export function policyTip(p: FishbonePolicy): string {
  const head = p.unresolved ? `${p.name} — not in the tree (unresolved link)` : `${p.name} (${p.kind})`;
  return p.description ? `${head}\n${p.description}` : head;
}

function boneTip(bone: FishboneBone): string {
  const n = bone.policies.length;
  return `${bone.label}: ${n === 0 ? "nothing linked" : n === 1 ? "1 policy" : `${n} policies`}. Click to link, unlink or reorder.`;
}

function clipIdFor(nodeId: string): string {
  return "clip-" + nodeId.replace(/[^A-Za-z0-9_-]/g, "_");
}

function shortName(p: FishbonePolicy): string {
  const n = p.name;
  return n.length > 22 ? n.slice(0, 20) + "…" : n;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}
