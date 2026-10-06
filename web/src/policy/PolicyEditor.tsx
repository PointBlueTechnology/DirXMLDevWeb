import { useState } from "react";
import { describeNode } from "../rules";
import { allowedChildren, grammar, groupOf, label, spec, type AttrSpec } from "./grammar";
import { at, elementChildren, insertIndex, ops, ownText, parse, room, type Path } from "./xmledit";

interface Props {
  xml: string;
  /** Called with the document after a structured edit. */
  onChange: (xml: string) => void;
}

/**
 * A DirXML Script policy as structure: rules, each with its condition groups and its actions,
 * every node editable down to the tokens. It is driven entirely by the grammar table, so every
 * condition, action and token of the language is available; what a node may hold, in what order
 * and how many, comes from there. The document stays the XML string the Source tab shows.
 */
export function PolicyEditor({ xml, onChange }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const doc = parse(xml);
  if (!doc) {
    return <div className="banner error">The source is not well-formed XML. Fix it in the Source tab; the structured view returns when it parses.</div>;
  }
  const root = doc.documentElement;
  if (root.tagName !== "policy") {
    return <p className="muted pad">The structured editor is for DirXML Script policies.</p>;
  }

  const apply = (next: string | null) => {
    if (next !== null) {
      onChange(next);
    }
  };
  const key = (p: Path) => p.join(".");
  const toggle = (p: Path) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key(p))) {
        n.delete(key(p));
      } else {
        n.add(key(p));
      }
      return n;
    });
  /** Positions shift under a parent when a child is removed or moved: close what was open there. */
  const closeUnder = (parent: Path) =>
    setOpen((s) => new Set([...s].filter((k) => !(k + ".").startsWith(key(parent) + (parent.length ? "." : "")) || k === key(parent))));
  const add = (parent: Path, tag: string) => {
    const p = at(doc, parent);
    if (!p) {
      return;
    }
    const index = insertIndex(p, tag);
    closeUnder(parent);
    setOpen((s) => new Set([...s, key([...parent, index])]));
    apply(ops.add(xml, parent, tag));
  };
  const remove = (path: Path) => {
    closeUnder(path.slice(0, -1));
    apply(ops.remove(xml, path));
  };
  const move = (path: Path, delta: -1 | 1) => {
    closeUnder(path.slice(0, -1));
    apply(ops.move(xml, path, delta));
  };

  const ctx: Ctx = { xml, doc, open, toggle, apply, add, remove, move };
  const kids = elementChildren(root);
  let n = 0;
  return (
    <div className="policy">
      {kids.map((child, i) => {
        if (child.tagName === "rule") {
          n++;
          return <RuleCard key={i} ctx={ctx} path={[i]} number={n} count={kids.length} />;
        }
        if (child.tagName === "include") {
          return (
            <section key={i} className="rule include">
              <header>
                <span className="num">↳</span>
                <span className="muted">include</span>
                <input className="grow" value={child.getAttribute("name") ?? ""} placeholder="policy DN" onChange={(e) => apply(ops.setAttr(xml, [i], "name", e.target.value))} />
                <Mover ctx={ctx} path={[i]} index={i} count={kids.length} />
              </header>
            </section>
          );
        }
        return null;
      })}
      {n === 0 && <p className="muted">This policy has no rules.</p>}
      <div className="addrow">
        <button onClick={() => add([], "rule")}>Add rule</button>
        <button onClick={() => add([], "include")}>Add include</button>
        <span className="muted small">
          DirXML Script {grammar.version}: {grammar.groups.conditions.length} conditions, {grammar.groups.actions.length} actions, {grammar.groups.tokens.length} tokens.
        </span>
      </div>
    </div>
  );
}

interface Ctx {
  xml: string;
  doc: Document;
  open: Set<string>;
  toggle: (p: Path) => void;
  apply: (xml: string | null) => void;
  add: (parent: Path, tag: string) => void;
  remove: (path: Path) => void;
  move: (path: Path, delta: -1 | 1) => void;
}

function Mover({ ctx, path, index, count }: { ctx: Ctx; path: Path; index: number; count: number }) {
  return (
    <span className="mover">
      <button className="mini" disabled={index === 0} title="Earlier" onClick={() => ctx.move(path, -1)}>
        ↑
      </button>
      <button className="mini" disabled={index >= count - 1} title="Later" onClick={() => ctx.move(path, 1)}>
        ↓
      </button>
      <button className="mini danger" title="Remove" onClick={() => ctx.remove(path)}>
        ×
      </button>
    </span>
  );
}

function RuleCard({ ctx, path, number, count }: { ctx: Ctx; path: Path; number: number; count: number }) {
  const rule = at(ctx.doc, path)!;
  const kids = elementChildren(rule);
  const description = kids.find((k) => k.tagName === "description")?.textContent ?? "";
  const ci = kids.findIndex((k) => k.tagName === "conditions");
  const ai = kids.findIndex((k) => k.tagName === "actions");
  const disabled = rule.getAttribute("disabled") === "true";
  return (
    <section className={disabled ? "rule disabled" : "rule"}>
      <header>
        <span className="num">{number}</span>
        <input className="grow title" value={description} placeholder="Rule description" onChange={(e) => ctx.apply(ops.setChildText(ctx.xml, path, "description", e.target.value))} />
        <label className="small" title="A disabled rule is skipped by the engine">
          <input type="checkbox" checked={disabled} onChange={(e) => ctx.apply(ops.setAttr(ctx.xml, path, "disabled", e.target.checked ? "true" : null))} /> disabled
        </label>
        <Mover ctx={ctx} path={path} index={path[path.length - 1]!} count={count} />
      </header>
      <div className="cols">
        <div>{ci >= 0 ? <Conditions ctx={ctx} path={[...path, ci]} /> : <button onClick={() => ctx.add(path, "conditions")}>Add conditions</button>}</div>
        <div>{ai >= 0 ? <Actions ctx={ctx} path={[...path, ai]} /> : <button onClick={() => ctx.add(path, "actions")}>Add actions</button>}</div>
      </div>
    </section>
  );
}

function AddSelect({ options, placeholder, onPick }: { options: string[]; placeholder: string; onPick: (tag: string) => void }) {
  return (
    <select
      className="addselect"
      value=""
      onChange={(e) => {
        if (e.target.value) {
          onPick(e.target.value);
        }
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((t) => (
        <option key={t} value={t}>
          {label(t)}
        </option>
      ))}
    </select>
  );
}

function Conditions({ ctx, path }: { ctx: Ctx; path: Path }) {
  const conditions = at(ctx.doc, path)!;
  const groups = elementChildren(conditions).filter((g) => g.tagName === "and" || g.tagName === "or");
  const kind = (groups[0]?.tagName ?? "and") as "and" | "or";
  const total = groups.reduce((n, g) => n + g.children.length, 0);
  return (
    <div className="block">
      <h4>
        When
        {groups.length > 1 || (groups[0]?.children.length ?? 0) > 1 ? (
          <select className="logic" value={kind} onChange={(e) => ctx.apply(ops.setGroupKind(ctx.xml, path, e.target.value as "and" | "or"))} title="How conditions combine">
            <option value="and">all in a group; any group</option>
            <option value="or">any in a group; every group</option>
          </select>
        ) : null}
      </h4>
      {total === 0 && <p className="muted small">always (no conditions)</p>}
      {groups.map((g, gi) => {
        const gpath = [...path, elementChildren(conditions).indexOf(g)];
        const items = elementChildren(g);
        return (
          <div key={gi} className="group">
            {groups.length > 1 && (
              <div className="grouphead">
                <span className="muted small">
                  group {gi + 1}: {g.tagName === "and" ? "all of" : "any of"}
                </span>
                <button className="mini danger" title="Remove this group" onClick={() => ctx.remove(gpath)}>
                  ×
                </button>
              </div>
            )}
            {items.map((c, i) => (
              <Node key={i} ctx={ctx} path={[...gpath, i]} index={i} count={items.length} />
            ))}
            <AddSelect options={grammar.groups.conditions} placeholder="+ condition" onPick={(t) => ctx.add(gpath, t)} />
          </div>
        );
      })}
      <button className="mini" onClick={() => ctx.add(path, kind)} title="Another group of conditions">
        + group
      </button>
    </div>
  );
}

function Actions({ ctx, path }: { ctx: Ctx; path: Path }) {
  const actions = at(ctx.doc, path)!;
  const items = elementChildren(actions);
  return (
    <div className="block">
      <h4>Do</h4>
      {items.length === 0 && <p className="muted small">nothing</p>}
      {items.map((_, i) => (
        <Node key={i} ctx={ctx} path={[...path, i]} index={i} count={items.length} />
      ))}
      <AddSelect options={grammar.groups.actions} placeholder="+ action" onPick={(t) => ctx.add(path, t)} />
    </div>
  );
}

/** Any element under a rule: one line when closed; its type, attributes, text and children when open. */
function Node({ ctx, path, index, count }: { ctx: Ctx; path: Path; index: number; count: number }) {
  const e = at(ctx.doc, path)!;
  const isOpen = ctx.open.has(path.join("."));
  const s = spec(e.tagName);
  const group = groupOf(e.tagName);
  const kids = elementChildren(e);
  const disabled = e.getAttribute("disabled") === "true";
  const missing = s.attrs.filter((a) => a.required && !(e.getAttribute(a.name) ?? "").trim()).map((a) => a.name);
  return (
    <div className={"node" + (isOpen ? " open" : "") + (disabled ? " off" : "")}>
      <div className="nodehead">
        <button className="summary" onClick={() => ctx.toggle(path)} title={isOpen ? "Close" : "Edit"}>
          <span className="caret">{isOpen ? "▾" : "▸"}</span>
          <code>{describeNode(e)}</code>
          {missing.length > 0 && <span className="pill err">needs {missing.join(", ")}</span>}
        </button>
        <Mover ctx={ctx} path={path} index={index} count={count} />
      </div>
      {isOpen && (
        <div className="nodebody">
          {group && (
            <label className="attr">
              <span>type</span>
              <select value={e.tagName} onChange={(ev) => ctx.apply(ops.retype(ctx.xml, path, ev.target.value))}>
                {grammar.groups[group].map((t) => (
                  <option key={t} value={t}>
                    {label(t)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {s.attrs.map((a) => (
            <AttrInput key={a.name} attr={a} value={e.getAttribute(a.name)} onChange={(v) => ctx.apply(ops.setAttr(ctx.xml, path, a.name, v))} />
          ))}
          {s.text && kids.length === 0 && (
            <label className="attr wide">
              <span>value</span>
              <input value={ownText(e)} spellCheck={false} onChange={(ev) => ctx.apply(ops.setText(ctx.xml, path, ev.target.value))} />
            </label>
          )}
          {kids.length > 0 && (
            <div className="children">
              {kids.map((_, i) => (
                <Node key={i} ctx={ctx} path={[...path, i]} index={i} count={kids.length} />
              ))}
            </div>
          )}
          <div className="adders">
            {s.children.map((c) => {
              if (c.group) {
                const first = grammar.groups[c.group][0]!;
                return room(e, first) > 0 ? <AddSelect key={c.group} options={grammar.groups[c.group]} placeholder={`+ ${c.group.replace(/s$/, "")}`} onPick={(t) => ctx.add(path, t)} /> : null;
              }
              return c.name && room(e, c.name) > 0 ? (
                <button key={c.name} className="mini" onClick={() => ctx.add(path, c.name!)}>
                  + {label(c.name)}
                </button>
              ) : null;
            })}
          </div>
          {allowedChildren(e.tagName).length === 0 && s.attrs.length === 0 && !s.text && <p className="muted small">Nothing to configure.</p>}
        </div>
      )}
    </div>
  );
}

function AttrInput({ attr, value, onChange }: { attr: AttrSpec; value: string | null; onChange: (v: string | null) => void }) {
  const set = (v: string) => onChange(v === "" && !attr.required ? null : v);
  return (
    <label className={"attr" + (attr.required && !(value ?? "").trim() ? " missing" : "")}>
      <span>
        {attr.name}
        {attr.required ? " *" : ""}
      </span>
      {attr.values ? (
        <select value={value ?? ""} onChange={(e) => set(e.target.value)}>
          {!attr.required && <option value="">{attr.default !== null ? `(${attr.default})` : "(unset)"}</option>}
          {value !== null && !attr.values.includes(value) && <option value={value}>{value}</option>}
          {attr.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : (
        <input value={value ?? ""} placeholder={attr.default ?? ""} spellCheck={false} onChange={(e) => set(e.target.value)} />
      )}
    </label>
  );
}
