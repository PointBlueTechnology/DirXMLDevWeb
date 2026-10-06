import { useEffect, useState } from "react";
import { api } from "../api";
import { writeEntitlement } from "../prov/entitlement";
import type { CatalogPackage, OpCall, Outline, Selection } from "../types";
import { ReviewDialog } from "./ReviewDialog";

type What = "policy" | "entitlement" | "form" | "prd" | "driver";

const TITLES: Record<What, string> = { policy: "New policy", entitlement: "New entitlement", form: "New form", prd: "New provisioning request definition", driver: "New driver" };

/**
 * Creating things: a policy (linked into a policy set, or left for later), an entitlement, a
 * form, a PRD from a template, a driver. Each is one of the core's `*.add` operations, reviewed
 * like any other change; afterwards the new thing opens.
 */
export function NewItemView({ what, driver, outline, onSelect, onSaved }: { what: What; driver: string | null; outline: Outline; onSelect: (s: Selection) => void; onSaved: () => Promise<void> | void }) {
  const [op, setOp] = useState<OpCall | null>(null);
  const [after, setAfter] = useState<((o: Outline) => Selection | null) | null>(null);
  const d = driver ? (outline.drivers.find((x) => x.name === driver) ?? null) : null;

  const stage = (call: OpCall, open: (o: Outline) => Selection | null) => {
    setOp(call);
    setAfter(() => open);
  };

  return (
    <div className="view newitem">
      <div className="viewhead">
        <div>
          <div className="kicker">{driver ?? "Library"}</div>
          <h2>{TITLES[what]}</h2>
        </div>
      </div>
      <div className="pad scroll">
        {what === "policy" && <NewPolicy driver={driver} onStage={stage} />}
        {what === "entitlement" && d && <NewEntitlement driver={d.name} onStage={stage} />}
        {what === "form" && d && <NewForm driver={d.name} forms={d.forms.map((f) => ({ name: f.name, kind: f.kind ?? "request" }))} onStage={stage} />}
        {what === "prd" && d && <NewPrd driver={d.name} forms={d.forms.map((f) => ({ name: f.name, kind: f.kind ?? "request" }))} prds={d.prds.map((p) => p.name)} onStage={stage} />}
        {what === "driver" && <NewDriver drivers={outline.drivers.map((x) => x.name)} onStage={stage} />}
      </div>
      {op && (
        <ReviewDialog
          title={TITLES[what]}
          ops={[op]}
          onClose={() => setOp(null)}
          onApplied={() => {
            setOp(null);
            void Promise.resolve(onSaved()).then(() => api.outline().then((o) => {
              const s = after ? after(o) : null;
              onSelect(s ?? { type: "home" });
            }));
          }}
        />
      )}
    </div>
  );
}

type Stage = (op: OpCall, open: (o: Outline) => Selection | null) => void;

const NAME = /^[^\\/:*?"<>|]+$/;

function findArtifact(o: Outline, driver: string | null, name: string): Selection | null {
  const pool = driver ? (o.drivers.find((x) => x.name === driver)?.policies ?? null) : null;
  const all = driver ? [...(pool?.driver ?? []), ...(pool?.subscriber ?? []), ...(pool?.publisher ?? []), ...(o.drivers.find((x) => x.name === driver)?.resources ?? [])] : [...o.library.policies, ...o.library.resources];
  const hit = all.find((a) => a.name === name);
  return hit ? { type: "artifact", path: hit.path } : null;
}

function NewPolicy({ driver, onStage }: { driver: string | null; onStage: Stage }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("policy");
  const [scope, setScope] = useState(driver ? "subscriber" : "library");
  const [link, setLink] = useState("");
  const [at, setAt] = useState("last");
  const [sets, setSets] = useState<{ key: string; label: string; channel: string }[]>([]);
  useEffect(() => {
    if (driver) {
      api
        .fishbone(driver)
        .then((m) => setSets([...m.spine, ...m.subscriber, ...m.publisher].map((b) => ({ key: b.key, label: b.label, channel: b.channel }))))
        .catch(() => setSets([]));
    }
  }, [driver]);
  const chosen = sets.find((s) => s.key === link);
  const ok = NAME.test(name.trim());
  return (
    <div className="attrs">
      <label className="field">
        <em>Name</em>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={driver ? "sub-ctp-NormalizeTitle" : "lib-Common"} spellCheck={false} data-testid="new-name" />
      </label>
      <label className="field">
        <em>Kind</em>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="policy">DirXML Script policy</option>
          <option value="xslt">XSLT style sheet</option>
          <option value="schema-map">schema mapping policy</option>
        </select>
      </label>
      {driver && (
        <label className="field">
          <em>Kept under</em>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="driver">the driver (driver scope)</option>
            <option value="subscriber">the Subscriber channel</option>
            <option value="publisher">the Publisher channel</option>
          </select>
        </label>
      )}
      {driver && (
        <label className="field">
          <em>Link into a policy set</em>
          <select value={link} onChange={(e) => setLink(e.target.value)} data-testid="new-link">
            <option value="">not yet (link it from the policy flow later)</option>
            {sets.map((s) => (
              <option key={s.key} value={s.key}>
                {s.channel}: {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {link && (
        <label className="field">
          <em>Position in {chosen?.label}</em>
          <select value={at} onChange={(e) => setAt(e.target.value)}>
            <option value="last">last</option>
            <option value="first">first</option>
          </select>
        </label>
      )}
      <div className="addrow">
        <button
          className="primary"
          disabled={!ok}
          onClick={() => {
            const args: Record<string, string> = { name: name.trim(), kind, scope };
            if (driver) {
              args.driver = driver;
            }
            if (link) {
              args.link = link;
              args.at = at;
            }
            onStage({ name: "policy.add", args, label: `create ${kind} ${name.trim()}${link ? ` and link it into ${chosen?.label ?? link}` : ""}` }, (o) => findArtifact(o, driver, name.trim()));
          }}
          data-testid="new-go"
        >
          Create
        </button>
      </div>
      <p className="muted small">A skeleton is written (one empty rule for a policy); edit it in the structured editor next. A policy set is a fixed slot on the driver — new policies are linked into one, not the other way round.</p>
    </div>
  );
}

function NewEntitlement({ driver, onStage }: { driver: string; onStage: Stage }) {
  const [f, setF] = useState({ name: "", displayName: "", description: "", conflict: "priority", multiValued: true, values: "" });
  const ok = NAME.test(f.name.trim());
  return (
    <div className="attrs">
      <label className="field">
        <em>Name (cn)</em>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="GroupMembership" spellCheck={false} data-testid="new-name" />
      </label>
      <label className="field">
        <em>Display name</em>
        <input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
      </label>
      <label className="field wide">
        <em>Description</em>
        <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </label>
      <label className="field">
        <em>Conflict resolution</em>
        <select value={f.conflict} onChange={(e) => setF({ ...f, conflict: e.target.value })}>
          <option value="priority">priority</option>
          <option value="union">union</option>
        </select>
      </label>
      <label className="checkchip">
        <input type="checkbox" checked={f.multiValued} onChange={(e) => setF({ ...f, multiValued: e.target.checked })} /> multi-valued
      </label>
      <label className="field wide">
        <em>Fixed values, one per line (leave empty for the requester's value; a query is added in the editor afterwards)</em>
        <textarea rows={3} value={f.values} onChange={(e) => setF({ ...f, values: e.target.value })} spellCheck={false} />
      </label>
      <div className="addrow">
        <button
          className="primary"
          disabled={!ok}
          onClick={() => {
            const values = f.values.split("\n").map((v) => v.trim()).filter(Boolean);
            const skeleton = `<?xml version="1.0" encoding="UTF-8"?>\n<entitlement conflict-resolution="priority" display-name=""><values multi-valued="true"/></entitlement>\n`;
            const xml = writeEntitlement(skeleton, { displayName: f.displayName || f.name.trim(), description: f.description, conflict: f.conflict, multiValued: f.multiValued }, values);
            onStage({ name: "entitlement.add", args: { name: f.name.trim(), driver }, files: { "definition-file": xml }, label: `create entitlement ${f.name.trim()} on ${driver}` }, (o) => {
              const e = o.drivers.find((x) => x.name === driver)?.entitlements.find((x) => x.name === f.name.trim());
              return e?.file ? { type: "entitlement", driver, name: e.name, file: e.file } : null;
            });
          }}
          data-testid="new-go"
        >
          Create
        </button>
      </div>
    </div>
  );
}

function NewForm({ driver, forms, onStage }: { driver: string; forms: { name: string; kind: string }[]; onStage: Stage }) {
  const [f, setF] = useState({ kind: "request", name: "", title: "", from: "" });
  const ok = NAME.test(f.name.trim()) && !forms.some((x) => x.name === f.name.trim());
  return (
    <div className="attrs">
      <label className="field">
        <em>Kind</em>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="request">request form</option>
          <option value="approval">approval form</option>
          <option value="template">template</option>
        </select>
      </label>
      <label className="field">
        <em>Name</em>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Request Access" data-testid="new-name" />
      </label>
      <label className="field">
        <em>Title (default: the name)</em>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </label>
      <label className="field">
        <em>Start from</em>
        <select value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
          <option value="">a blank form</option>
          {forms.map((x) => (
            <option key={x.kind + x.name} value={x.name}>
              a copy of {x.name} ({x.kind})
            </option>
          ))}
        </select>
      </label>
      <div className="addrow">
        <button
          className="primary"
          disabled={!ok}
          onClick={() => {
            const args: Record<string, string> = { kind: f.kind, name: f.name.trim(), driver };
            if (f.title) {
              args.title = f.title;
            }
            if (f.from) {
              args.from = f.from;
            }
            onStage({ name: "form.add", args, label: `create ${f.kind} form ${f.name.trim()}` }, () => ({ type: "form", driver, name: f.name.trim() }));
          }}
          data-testid="new-go"
        >
          Create
        </button>
      </div>
    </div>
  );
}

function NewPrd({ driver, forms, prds, onStage }: { driver: string; forms: { name: string; kind: string }[]; prds: string[]; onStage: Stage }) {
  const [f, setF] = useState({ name: "", from: "", request: "", approval: "", category: "", mapAll: true });
  const ok = NAME.test(f.name.trim()) && f.from && f.request;
  return (
    <div className="attrs">
      <label className="field">
        <em>Name</em>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Request Group Access" data-testid="new-name" />
      </label>
      <label className="field">
        <em>From template (a PRD with status Template)</em>
        <input list="prd-templates" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="NoApproval, SingleStepApproval, …" spellCheck={false} />
        <datalist id="prd-templates">
          {prds.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <em>Request form</em>
        <select value={f.request} onChange={(e) => setF({ ...f, request: e.target.value })}>
          <option value="">choose…</option>
          {forms.filter((x) => x.kind === "request").map((x) => (
            <option key={x.name} value={x.name}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <em>Approval form (for the first approval activity, if the template has one)</em>
        <select value={f.approval} onChange={(e) => setF({ ...f, approval: e.target.value })}>
          <option value="">none</option>
          {forms.filter((x) => x.kind === "approval").map((x) => (
            <option key={x.name} value={x.name}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <em>Category (default: the template's)</em>
        <input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} spellCheck={false} />
      </label>
      <label className="checkchip">
        <input type="checkbox" checked={f.mapAll} onChange={(e) => setF({ ...f, mapAll: e.target.checked })} /> map every field of the forms to flowdata with the defaults
      </label>
      <div className="addrow">
        <button
          className="primary"
          disabled={!ok}
          onClick={() => {
            const args: Record<string, string> = { name: f.name.trim(), "from-template": f.from, "request-form": f.request, driver };
            if (f.approval) {
              args["approval-form"] = f.approval;
            }
            if (f.category) {
              args.category = f.category;
            }
            if (f.mapAll) {
              args["map-all"] = "true";
            }
            onStage({ name: "prd.add", args, label: `create PRD ${f.name.trim()} from ${f.from}` }, () => ({ type: "prd", driver, name: f.name.trim() }));
          }}
          data-testid="new-go"
        >
          Create
        </button>
      </div>
      <p className="muted small">Templates come with the User Application driver (NoApproval, SingleStepApproval, the TemplateN… ones); a copy becomes an Active PRD bound to your forms.</p>
    </div>
  );
}

function NewDriver({ drivers, onStage }: { drivers: string[]; onStage: Stage }) {
  const [f, setF] = useState({ name: "", how: "package", copyOf: drivers[0] ?? "", shim: "", pkg: "", authServer: "", authId: "" });
  const [bases, setBases] = useState<CatalogPackage[]>([]);
  const [catalog, setCatalog] = useState(true);
  useEffect(() => {
    api
      .packages()
      .then((p) => {
        setCatalog(p.catalog.available);
        setBases(p.catalog.packages.filter((x) => x.type === 2 && x.base));
      })
      .catch(() => setCatalog(false));
  }, []);
  const ok = NAME.test(f.name.trim()) && !drivers.includes(f.name.trim()) && (f.how === "copy" ? !!f.copyOf : f.how === "blank" ? !!f.shim.trim() : !!f.pkg);
  return (
    <div className="attrs">
      <label className="field">
        <em>Name</em>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Active Directory" data-testid="new-name" />
      </label>
      <label className="field">
        <em>Built from</em>
        <select value={f.how} onChange={(e) => setF({ ...f, how: e.target.value })} data-testid="new-driver-how">
          <option value="package">a base package in the catalog{catalog ? "" : " (no catalog on this server)"}</option>
          <option value="copy">a copy of another driver</option>
          <option value="blank">a blank driver with a shim class</option>
        </select>
      </label>
      {f.how === "package" && (
        <label className="field wide">
          <em>Base package</em>
          <select value={f.pkg} onChange={(e) => setF({ ...f, pkg: e.target.value })} disabled={!catalog}>
            <option value="">choose…</option>
            {bases.map((b) => (
              <option key={b.short} value={b.short}>
                {b.short} — {b.displayName ?? ""} ({b.newest})
              </option>
            ))}
          </select>
        </label>
      )}
      {f.how === "copy" && (
        <label className="field">
          <em>Copy of</em>
          <select value={f.copyOf} onChange={(e) => setF({ ...f, copyOf: e.target.value })}>
            {drivers.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )}
      {f.how === "blank" && (
        <>
          <label className="field wide">
            <em>Shim class</em>
            <input value={f.shim} onChange={(e) => setF({ ...f, shim: e.target.value })} placeholder="com.novell.nds.dirxml.driver.loopback.LoopbackDriverShim" spellCheck={false} />
          </label>
          <label className="field">
            <em>Authentication server (optional)</em>
            <input value={f.authServer} onChange={(e) => setF({ ...f, authServer: e.target.value })} spellCheck={false} />
          </label>
          <label className="field">
            <em>Authentication id (optional)</em>
            <input value={f.authId} onChange={(e) => setF({ ...f, authId: e.target.value })} spellCheck={false} />
          </label>
        </>
      )}
      <div className="addrow">
        <button
          className="primary"
          disabled={!ok}
          onClick={() => {
            const args: Record<string, string> = { name: f.name.trim() };
            if (f.how === "package") {
              args.package = f.pkg;
            } else if (f.how === "copy") {
              args["copy-of"] = f.copyOf;
            } else {
              args["shim-class"] = f.shim.trim();
              if (f.authServer) {
                args["auth-server"] = f.authServer;
              }
              if (f.authId) {
                args["auth-id"] = f.authId;
              }
            }
            onStage({ name: "driver.add", args, label: `create driver ${f.name.trim()}` }, () => ({ type: "flow", driver: f.name.trim() }));
          }}
          data-testid="new-go"
        >
          Create
        </button>
      </div>
      <p className="muted small">A packaged driver takes the base package's prompts with their defaults; the Packages view installs feature packages afterwards. A Designer export of a driver can be merged in through Operations → driver.add --from-export.</p>
    </div>
  );
}
