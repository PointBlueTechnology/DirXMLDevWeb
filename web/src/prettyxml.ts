/**
 * Indent an XML document for reading and for a line diff: one element per line, text kept on
 * its element's line. The simulator hands back each stage's document on a single line.
 * Text that does not parse is returned as it came.
 */
export function prettyXml(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (!doc.documentElement || doc.getElementsByTagName("parsererror").length > 0) {
    return xml;
  }
  const out: string[] = [];
  write(doc.documentElement, 0, out);
  return out.join("\n") + "\n";
}

function esc(s: string, attr: boolean): string {
  const t = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return attr ? t.replace(/"/g, "&quot;") : t;
}

function write(el: Element, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth);
  const attrs = Array.from(el.attributes)
    .map((a) => ` ${a.name}="${esc(a.value, true)}"`)
    .join("");
  const kids = Array.from(el.childNodes).filter((n) => n.nodeType === 1 || ((n.nodeType === 3 || n.nodeType === 4) && (n.nodeValue ?? "").trim() !== ""));
  if (kids.length === 0) {
    out.push(`${pad}<${el.tagName}${attrs}/>`);
    return;
  }
  if (kids.every((n) => n.nodeType !== 1)) {
    out.push(`${pad}<${el.tagName}${attrs}>${esc(kids.map((n) => n.nodeValue ?? "").join(""), false)}</${el.tagName}>`);
    return;
  }
  out.push(`${pad}<${el.tagName}${attrs}>`);
  for (const n of kids) {
    if (n.nodeType === 1) {
      write(n as Element, depth + 1, out);
    } else {
      out.push(`${pad}  ${esc((n.nodeValue ?? "").trim(), false)}`);
    }
  }
  out.push(`${pad}</${el.tagName}>`);
}
