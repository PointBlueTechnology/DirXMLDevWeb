import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { usePending } from "../pending";
import { NODE_H, NODE_W, layout } from "../prov/layout";
import type { FlowActivity, FlowLink, PrdData, Selection } from "../types";
import { PendingBar } from "./PendingBar";

/** The kinds `flow.activity.add` inserts; a branch is its own operation. */
const ADD_KINDS = ["approval", "condition", "log", "notification", "mapping", "provision", "rest", "role-request", "resource-request", "start-flow"];

const LINK_COLOR: Record<string, string> = {
  approved: "var(--ok)",
  true: "var(--ok)",
  success: "var(--ok)",
  denied: "var(--err)",
  refused: "var(--err)",
  false: "var(--err)",
  fault: "var(--err)",
  error: "var(--err)",
  timedout: "var(--warn)",
};

/**
 * A provisioning request definition: its workflow drawn from the core's flow model, and every
 * change to it staged as one of the core's `flow.*` operations and reviewed like any other edit.
 */
export function PrdView({ driver, name, revision, onSelect, onSaved }: { driver: string; name: string; revision: string; onSelect: (s: Selection) => void; onSaved: () => void }) {
  const [data, setData] = useState<PrdData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"flow" | "details">("flow");
  const pending = usePending();

  useEffect(() => {
    let gone = false;
    api
      .prd(driver, name)
      .then((d) => !gone && (setData(d), setError(null)))
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [driver, name, revision]);

  const flow = data?.flow ?? null;
  const laid = useMemo(() => (flow ? layout(flow.activities.map((a) => a.id), flow.links, flow.activities.find((a) => a.kind === "start")?.id) : null), [flow]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data) {
    return <p className="muted pad">Loading…</p>;
  }
  const op = (opName: string, args: Record<string, string>, label: string, key?: string) => {
    const call = { name: opName, args: { prd: name, driver, ...args }, label };
    if (opName === "") {
      // the field went back to what the tree holds: withdraw its staged change
      pending.put(key!, null);
    } else if (key) {
      pending.put(key, call);
    } else {
      pending.add(call);
    }
  };
  const activity = flow?.activities.find((a) => a.id === selected) ?? null;

  return (
    <div className="view prd">
      <div className="viewhead">
        <div>
          <div className="kicker">
            {driver} · provisioning request definition{data.jsonForms ? "" : " · classic forms"}
          </div>
          <h2>{name}</h2>
        </div>
        {data.status && <span className={data.status === "Active" ? "pill ok" : "pill"}>{data.status}</span>}
        <span className="spacer" />
        <div className="tabs">
          <button className={tab === "flow" ? "tab active" : "tab"} onClick={() => setTab("flow")}>
            Workflow
          </button>
          <button className={tab === "details" ? "tab active" : "tab"} onClick={() => setTab("details")} data-testid="prd-tab-details">
            Details
          </button>
        </div>
      </div>
      <PendingBar pending={pending} title={`Review changes to ${name}`} onSaved={onSaved} />
      {tab === "flow" &&
        (flow && laid ? (
          <div className="prdbody">
            <div className="prdcanvas">
              <FlowDiagram activities={flow.activities} links={flow.links} laid={laid} selected={selected} onSelect={setSelected} />
              <p className="muted small pad-x">
                {flow.activities.length} activities, {flow.links.length} links. Select an activity to see and change it.
              </p>
            </div>
            {activity && (
              <ActivityPanel
                key={activity.id + activity.xml}
                a={activity}
                flow={flow}
                forms={data.forms}
                op={op}
                onOpenForm={(form) => onSelect({ type: "form", driver, name: form })}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        ) : (
          <p className="muted pad">This PRD has no workflow document.</p>
        ))}
      {tab === "details" && <Details data={data} op={op} onSelect={onSelect} />}
    </div>
  );
}

type Op = (opName: string, args: Record<string, string>, label: string, key?: string) => void;

function FlowDiagram({
  activities,
  links,
  laid,
  selected,
  onSelect,
}: {
  activities: FlowActivity[];
  links: FlowLink[];
  laid: ReturnType<typeof layout>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const pad = 24;
  // links between the same two activities fan out so each label can be read
  const seen = new Map<string, number>();
  return (
    <svg className="flowsvg" width={laid.width + pad * 2} height={laid.height + pad * 2 + 30} data-testid="prd-diagram">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
      </defs>
      <g transform={`translate(${pad},${pad})`}>
        {links.map((l, i) => {
          const a = laid.nodes[l.from];
          const b = laid.nodes[l.to];
          if (!a || !b) {
            return null;
          }
          const pair = `${l.from}>${l.to}`;
          const n = seen.get(pair) ?? 0;
          seen.set(pair, n + 1);
          const color = LINK_COLOR[l.type] ?? "var(--muted)";
          const isBack = laid.back.has(pair) || b.x <= a.x;
          const x1 = isBack ? a.x + NODE_W / 2 : a.x + NODE_W;
          const y1 = isBack ? a.y + NODE_H : a.y + NODE_H / 2;
          const x2 = isBack ? b.x + NODE_W / 2 : b.x;
          const y2 = isBack ? b.y + NODE_H : b.y + NODE_H / 2;
          const bend = n * 22;
          const d = isBack
            ? `M ${x1} ${y1} C ${x1} ${y1 + 50 + bend}, ${x2} ${y2 + 50 + bend}, ${x2} ${y2}`
            : `M ${x1} ${y1} C ${x1 + 35} ${y1 + bend}, ${x2 - 35} ${y2 + bend}, ${x2} ${y2}`;
          const lx = (x1 + x2) / 2;
          const ly = isBack ? Math.max(y1, y2) + 36 + bend : (y1 + y2) / 2 + bend * 0.75 - 4;
          return (
            <g key={i}>
              <path d={d} fill="none" stroke={color} strokeWidth={1.5} markerEnd="url(#arrow)" />
              {l.type !== "forward" && (
                <text x={lx} y={ly} textAnchor="middle" className="linklabel" fill={color}>
                  {l.type}
                </text>
              )}
            </g>
          );
        })}
        {activities.map((a) => {
          const p = laid.nodes[a.id];
          if (!p) {
            return null;
          }
          return (
            <g key={a.id} transform={`translate(${p.x},${p.y})`} className={"flownode k-" + a.kind + (selected === a.id ? " sel" : "")} onClick={() => onSelect(a.id)} data-activity={a.id}>
              <rect width={NODE_W} height={NODE_H} rx={a.kind === "start" || a.kind === "finish" ? 23 : 6} />
              <text x={NODE_W / 2} y={19} textAnchor="middle" className="nodename">
                {clip(a.name || a.id, 22)}
              </text>
              <text x={NODE_W / 2} y={35} textAnchor="middle" className="nodekind">
                {a.kind}
                {a.name && a.name !== a.id ? ` · ${clip(a.id, 14)}` : ""}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function ActivityPanel({
  a,
  flow,
  forms,
  op,
  onOpenForm,
  onClose,
}: {
  a: FlowActivity;
  flow: NonNullable<PrdData["flow"]>;
  forms: string[];
  op: Op;
  onOpenForm: (form: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(a.name ?? "");
  const [form, setForm] = useState(a.form ?? "");
  const [addressee, setAddressee] = useState(a.parts.addressee ?? "");
  const [timeout, setTimeoutValue] = useState(a.attrs.timeout ?? "");
  const [newId, setNewId] = useState(a.id);
  const [link, setLink] = useState({ to: "", type: a.linkTypes[0] ?? "forward" });
  const [item, setItem] = useState({ name: "", source: "", target: "" });
  const [add, setAdd] = useState({ kind: "log", id: "", name: "", via: "", form: "", addressee: "", expression: "", message: "" });
  const outgoing = flow.links.filter((l) => l.from === a.id);
  const outTypes = [...new Set(outgoing.map((l) => l.type))];
  const needsVia = outgoing.length > 1;
  const incoming = flow.links.filter((l) => l.to === a.id);
  const others = flow.activities.filter((x) => x.id !== a.id);
  const fixed = a.kind === "start" || a.kind === "finish";
  const set = (field: string, value: string, was: string) =>
    value === was ? op("", {}, "", `set:${a.id}:${field}`) : op("flow.activity.set", { id: a.id, [field]: value }, `${a.id}: ${field} = ${value || "(empty)"}`, `set:${a.id}:${field}`);

  return (
    <aside className="prdpanel" data-testid="prd-panel">
      <div className="panelhead">
        <strong>{a.id}</strong>
        <span className="pill">{a.kind}</span>
        <span className="spacer" />
        <button onClick={onClose}>Close</button>
      </div>
      <div className="pad scroll">
        <h4>Properties</h4>
        <label className="field">
          <em>Display name</em>
          <input value={name} onChange={(e) => (setName(e.target.value), set("name", e.target.value, a.name ?? ""))} data-testid="prd-name" />
        </label>
        {a.kind === "user" && (
          <>
            <label className="field">
              <em>Approval form</em>
              <select value={form} onChange={(e) => (setForm(e.target.value), set("form", e.target.value, a.form ?? ""))}>
                {!forms.includes(form) && <option value={form}>{form || "none"}</option>}
                {forms.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            {a.form && (
              <button className="link" onClick={() => onOpenForm(a.form!)}>
                Open the form
              </button>
            )}
            <label className="field">
              <em>Addressee (an expression)</em>
              <input value={addressee} onChange={(e) => (setAddressee(e.target.value), set("addressee", e.target.value, a.parts.addressee ?? ""))} spellCheck={false} />
            </label>
            <label className="field">
              <em>Timeout (ms)</em>
              <input value={timeout} onChange={(e) => (setTimeoutValue(e.target.value), set("timeout", e.target.value, a.attrs.timeout ?? ""))} />
            </label>
          </>
        )}
        <details>
          <summary className="muted small">The activity's XML</summary>
          <pre className="outcome">{a.xml}</pre>
        </details>
        <p className="muted small">Other settings of this activity (expression, message, REST call, role or resource request) change through Operations → flow.activity.set.</p>

        <h4>Links out</h4>
        {outgoing.length === 0 && <p className="muted small">None.</p>}
        {outgoing.map((l, i) => (
          <div key={i} className="addrow tight">
            <select value={l.type} onChange={(e) => op("flow.link.retype", { from: l.from, to: l.to, type: l.type, "to-type": e.target.value }, `link ${l.from} → ${l.to}: ${l.type} becomes ${e.target.value}`)}>
              {[...new Set([l.type, ...a.linkTypes])].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span>→ {l.to}</span>
            <button onClick={() => op("flow.link.remove", { from: l.from, to: l.to, type: l.type }, `remove link ${l.from} → ${l.to} (${l.type})`)}>Remove</button>
          </div>
        ))}
        {a.kind !== "finish" && (
          <div className="addrow tight">
            <select value={link.type} onChange={(e) => setLink({ ...link, type: e.target.value })}>
              {a.linkTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select value={link.to} onChange={(e) => setLink({ ...link, to: e.target.value })} data-testid="prd-link-to">
              <option value="">to…</option>
              {others.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.id}
                </option>
              ))}
            </select>
            <button disabled={!link.to} onClick={() => (op("flow.link.add", { from: a.id, to: link.to, type: link.type }, `add link ${a.id} → ${link.to} (${link.type})`), setLink({ ...link, to: "" }))} data-testid="prd-link-add">
              Add link
            </button>
          </div>
        )}
        <p className="muted small">
          In from: {incoming.length === 0 ? "nothing" : incoming.map((l) => `${l.from} (${l.type})`).join(", ")}
        </p>

        <h4>Data items</h4>
        {a.dataItems.length === 0 && <p className="muted small">None.</p>}
        {a.dataItems.map((d) => (
          <div key={d.name} className="dataitem">
            <code>{d.name}</code>
            <span className="muted small">{d.source ? `from ${d.source}` : d.target ? `to ${d.target}` : ""}</span>
            <button onClick={() => op("flow.data.remove", { activity: a.id, name: d.name }, `${a.id}: remove data item ${d.name}`)}>Remove</button>
          </div>
        ))}
        <div className="addrow tight">
          <input placeholder="name" value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} />
          <input placeholder="source expression" value={item.source} onChange={(e) => setItem({ ...item, source: e.target.value })} spellCheck={false} />
          <input placeholder="or target" value={item.target} onChange={(e) => setItem({ ...item, target: e.target.value })} spellCheck={false} />
          <button
            disabled={!item.name || (!item.source && !item.target)}
            onClick={() => {
              const args: Record<string, string> = { activity: a.id, name: item.name };
              if (item.source) {
                args.source = item.source;
              }
              if (item.target) {
                args.target = item.target;
              }
              op("flow.data.set", args, `${a.id}: data item ${item.name}`);
              setItem({ name: "", source: "", target: "" });
            }}
          >
            Set
          </button>
        </div>

        {a.kind !== "finish" && (
          <>
            <h4>Insert an activity after this one</h4>
            <div className="addrow tight">
              <select value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value })} data-testid="prd-add-kind">
                {ADD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <input placeholder="id" value={add.id} onChange={(e) => setAdd({ ...add, id: e.target.value })} spellCheck={false} data-testid="prd-add-id" />
              <input placeholder="display name" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
            </div>
            <div className="addrow tight">
              {needsVia && (
                <select value={add.via} onChange={(e) => setAdd({ ...add, via: e.target.value })} title="Which of this activity's links the new one goes on" data-testid="prd-add-via">
                  <option value="">on which link?</option>
                  {outTypes.map((t) => (
                    <option key={t} value={t}>
                      on {t}
                    </option>
                  ))}
                </select>
              )}
              {add.kind === "approval" && (
                <>
                  <select value={add.form} onChange={(e) => setAdd({ ...add, form: e.target.value })}>
                    <option value="">approval form…</option>
                    {forms.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <input placeholder="addressee expression" value={add.addressee} onChange={(e) => setAdd({ ...add, addressee: e.target.value })} spellCheck={false} />
                </>
              )}
              {add.kind === "condition" && <input className="wide" placeholder="expression" value={add.expression} onChange={(e) => setAdd({ ...add, expression: e.target.value })} spellCheck={false} />}
              {add.kind === "log" && <input className="wide" placeholder="message expression, e.g. 'approved'" value={add.message} onChange={(e) => setAdd({ ...add, message: e.target.value })} spellCheck={false} data-testid="prd-add-message" />}
              <button
                disabled={!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(add.id) || flow.activities.some((x) => x.id === add.id) || (needsVia && !add.via)}
                onClick={() => {
                  const args: Record<string, string> = { kind: add.kind, id: add.id, after: a.id };
                  for (const k of ["name", "via", "form", "addressee", "expression", "message"] as const) {
                    if (add[k]) {
                      args[k] = add[k];
                    }
                  }
                  op("flow.activity.add", args, `add ${add.kind} activity ${add.id} after ${a.id}`);
                  setAdd({ ...add, id: "", name: "" });
                }}
                data-testid="prd-add"
              >
                Insert
              </button>
            </div>
            <p className="muted small">The core wires the new activity's links. Kinds with more settings take them through Operations → flow.activity.add.</p>
          </>
        )}

        {!fixed && (
          <>
            <h4>This activity</h4>
            <div className="addrow tight">
              <input value={newId} onChange={(e) => setNewId(e.target.value)} spellCheck={false} />
              <button disabled={newId === a.id || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(newId)} onClick={() => op("flow.activity.rename", { id: a.id, to: newId }, `rename activity ${a.id} to ${newId}`)}>
                Rename id
              </button>
              <button
                className="danger"
                onClick={() =>
                  a.kind === "branch" ? op("flow.branch.remove", { id: a.id }, `remove branch ${a.id} and its merge`) : op("flow.activity.remove", { id: a.id }, `remove activity ${a.id}, reconnecting around it`)
                }
                data-testid="prd-remove"
              >
                Remove
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

const PROCESS_ATTRS = ["version", "process-type", "flow-strategy", "default-completed-approval-status", "setnotify", "restrict-view", "generate-comments"];

function Details({ data, op, onSelect }: { data: PrdData; op: Op; onSelect: (s: Selection) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(PROCESS_ATTRS.map((k) => [k, data.flow?.process[k] ?? ""])));
  return (
    <div className="pad scroll">
      <h3>Definition</h3>
      <table className="grid">
        <tbody>
          {Object.entries(data.properties).map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v.join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.flow && (
        <>
          <h3>Process</h3>
          <div className="attrs">
            {PROCESS_ATTRS.map((k) => (
              <label key={k} className="field">
                <em>{k}</em>
                <input
                  value={values[k] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setValues({ ...values, [k]: v });
                    const was = data.flow?.process[k] ?? "";
                    if (v === was) {
                      op("", {}, "", `process:${k}`);
                    } else {
                      op("flow.set", { [k]: v }, `process ${k} = ${v}`, `process:${k}`);
                    }
                  }}
                />
              </label>
            ))}
          </div>
        </>
      )}
      <h3>Forms</h3>
      <table className="grid">
        <thead>
          <tr>
            <th>Shown at</th>
            <th>Form</th>
            <th>Fields the PRD maps</th>
          </tr>
        </thead>
        <tbody>
          {data.bindings.map((b, i) => (
            <tr key={i}>
              <td>{b.activity ?? "the request"}</td>
              <td>
                <button className="link" onClick={() => onSelect({ type: "form", driver: data.driver, name: b.form })}>
                  {b.form}
                </button>
              </td>
              <td>{b.fields.length === 0 ? <span className="muted">none</span> : b.fields.map((f) => f.name).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Field mappings change through Operations → prd.map. The PRD's files are in <code>{data.dir}</code>:{" "}
        {["definition.xml", "request.xml", "process.xml"].map((f) => (
          <button key={f} className="link" onClick={() => onSelect({ type: "file", file: `${data.dir}/${f}` })}>
            {f}{" "}
          </button>
        ))}
      </p>
    </div>
  );
}
