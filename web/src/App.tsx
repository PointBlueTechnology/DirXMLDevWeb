import { useCallback, useEffect, useState } from "react";
import { ApiError, api, followTree, takeToken } from "./api";
import type { ArtifactNode, OpCall, Outline, Selection, Session, Validation } from "./types";
import { ConfigEditor } from "./components/ConfigEditor";
import { OverridesView } from "./components/OverridesView";
import { OutlineTree } from "./components/OutlineTree";
import { ArtifactView } from "./components/ArtifactView";
import { FileView } from "./components/FileView";
import { FlowView } from "./components/FlowView";
import { OperationsView } from "./components/OperationsView";
import { ValidationPanel } from "./components/ValidationPanel";
import { VaultView } from "./components/VaultView";
import { SimView } from "./components/SimView";
import { PrdView } from "./components/PrdView";
import { FormView } from "./components/FormView";
import { RolesView } from "./components/RolesView";

export function App() {
  const [token] = useState(() => takeToken());
  const [session, setSession] = useState<Session | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [revision, setRevision] = useState<string>("");
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ type: "home" });
  const [opNames, setOpNames] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    try {
      const [o, v] = await Promise.all([api.outline(), api.validation()]);
      setOutline(o);
      setValidation(v);
      setRevision(o.revision);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "This session is not authorised. Open the URL the server printed (it carries the token)." : String(e instanceof Error ? e.message : e));
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setError("No session token. Open the URL that `bin/idmweb serve` printed; it ends in #token=…");
      return;
    }
    api.session().then(setSession).catch(() => undefined);
    api
      .catalog()
      .then((c) => setOpNames(new Set(c.operations.map((o) => o.name))))
      .catch(() => undefined);
    void reload();
    return followTree(
      (rev) => {
        setRevision((current) => {
          if (current !== rev) {
            void reload();
          }
          return rev;
        });
      },
      setLive,
    );
  }, [token, reload]);

  const open = useCallback(
    (path: string) => {
      // a finding or a reference names an artifact path, a driver, or a file of the tree
      if (!outline) {
        return;
      }
      const all = [
        ...outline.library.policies,
        ...outline.library.resources,
        ...outline.drivers.flatMap((d) => [...d.policies.driver, ...d.policies.subscriber, ...d.policies.publisher, ...d.resources]),
      ];
      if (path === "driverset") {
        setSelection({ type: "config", driver: null });
        return;
      }
      if (all.some((a) => a.path === path)) {
        setSelection({ type: "artifact", path });
        return;
      }
      const driver = outline.drivers.find((d) => path === `drivers/${d.name}`);
      if (driver) {
        setSelection({ type: "flow", driver: driver.name });
        return;
      }
      if (/\.[a-z]+$/.test(path)) {
        setSelection({ type: "file", file: path });
      }
    },
    [outline],
  );

  const artifacts: ArtifactNode[] = outline
    ? [...outline.library.policies, ...outline.library.resources, ...outline.drivers.flatMap((d) => [...d.policies.driver, ...d.policies.subscriber, ...d.policies.publisher, ...d.resources])]
    : [];

  /** The operation that saves a whole file, for the files the core can replace in one call. */
  const saveOpFor = (file: string): ((content: string) => OpCall) | null => {
    if (!outline) {
      return null;
    }
    const kinds = ["config-values", "shim-config-info", "driver-filter", "engine-control-values"];
    if (opNames.has("config.set-content")) {
      if (file === "config-values.xml") {
        return (content) => ({ name: "config.set-content", args: { kind: "config-values" }, files: { "content-file": content }, label: "replace the driver set's config-values" });
      }
      for (const d of outline.drivers) {
        for (const kind of kinds) {
          if (file === `${d.dir}/${kind}.xml`) {
            return (content) => ({ name: "config.set-content", args: { kind, driver: d.name }, files: { "content-file": content }, label: `replace ${d.name}'s ${kind}` });
          }
        }
      }
    }
    for (const d of outline.drivers) {
      const ent = d.entitlements.find((e) => e.file === file);
      if (ent && opNames.has("entitlement.set")) {
        return (content) => ({ name: "entitlement.set", args: { name: ent.name, driver: d.name }, files: { "definition-file": content }, label: `replace the definition of entitlement ${ent.name}` });
      }
    }
    return null;
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">DirXMLDevWeb</span>
          {outline && <span className="set">{outline.driverSet.name}</span>}
        </div>
        <div className="meta">
          {session && <span title={session.tree}>{shorten(session.tree)}</span>}
          {session && (
            <span>
              web {session.version} · core {session.core ?? "?"}
            </span>
          )}
          <span className="rev" title="The tree's revision: it changes when anything edits the tree">
            rev {revision ? revision.slice(0, 8) : "…"}
          </span>
          <span className={live ? "live on" : "live off"} title={live ? "Following the tree on disk" : "Not connected to the server"}>
            {live ? "live" : "offline"}
          </span>
        </div>
      </header>
      {error && <div className="banner error">{error}</div>}
      <div className="body">
        <nav className="sidebar">
          <button className={selection.type === "operations" ? "navbtn active" : "navbtn"} onClick={() => setSelection({ type: "operations" })}>
            Operations
          </button>
          <button className={selection.type === "vault" ? "navbtn active" : "navbtn"} onClick={() => setSelection({ type: "vault" })}>
            Vault
          </button>
          <button className={selection.type === "simulator" ? "navbtn active" : "navbtn"} onClick={() => setSelection({ type: "simulator" })}>
            Simulator
          </button>
          {outline?.drivers.some((d) => d.forms.length + d.prds.length > 0) && (
            <button className={selection.type === "roles" ? "navbtn active" : "navbtn"} onClick={() => setSelection({ type: "roles" })}>
              Roles and resources
            </button>
          )}
          {outline ? <OutlineTree outline={outline} selection={selection} onSelect={setSelection} /> : <p className="muted pad">Loading the tree…</p>}
        </nav>
        <main className="main">
          {selection.type === "home" && <Home outline={outline} validation={validation} onSelect={setSelection} />}
          {selection.type === "flow" && <FlowView key={selection.driver} driver={selection.driver} revision={revision} onOpen={open} onOpenFile={(file) => setSelection({ type: "file", file })} />}
          {selection.type === "artifact" && <ArtifactView key={selection.path} path={selection.path} revision={revision} onOpen={open} onSaved={reload} />}
          {selection.type === "file" && <FileView key={selection.file} file={selection.file} revision={revision} saveOp={saveOpFor(selection.file)} onSaved={reload} />}
          {selection.type === "config" && outline && (
            <ConfigEditor
              key={selection.driver ?? "__set"}
              driver={selection.driver === null ? null : (outline.drivers.find((d) => d.name === selection.driver) ?? null)}
              setName={outline.driverSet.name}
              revision={revision}
              canOverride={opNames.has("override.set")}
              linkable={artifacts}
              onOpen={open}
              onSaved={reload}
            />
          )}
          {selection.type === "overrides" && <OverridesView revision={revision} canEdit={opNames.has("override.set")} onSaved={reload} />}
          {selection.type === "operations" && <OperationsView onDone={reload} />}
          {selection.type === "prd" && <PrdView key={selection.driver + "/" + selection.name} driver={selection.driver} name={selection.name} revision={revision} onSelect={setSelection} onSaved={reload} />}
          {selection.type === "form" && <FormView key={selection.driver + "/" + selection.name} driver={selection.driver} name={selection.name} revision={revision} onSelect={setSelection} onSaved={reload} />}
          {selection.type === "roles" && <RolesView revision={revision} onSaved={reload} />}
          {selection.type === "simulator" && outline && <SimView drivers={outline.drivers.map((d) => d.name)} revision={revision} />}
          {selection.type === "vault" && outline && <VaultView drivers={outline.drivers.map((d) => d.name)} revision={revision} onOpen={open} />}
        </main>
        <aside className="problems">
          <ValidationPanel validation={validation} onOpen={open} />
        </aside>
      </div>
    </div>
  );
}

function shorten(path: string): string {
  const parts = path.split("/");
  return parts.length > 4 ? "…/" + parts.slice(-3).join("/") : path;
}

function Home({ outline, validation, onSelect }: { outline: Outline | null; validation: Validation | null; onSelect: (s: Selection) => void }) {
  if (!outline) {
    return <p className="muted pad">Loading…</p>;
  }
  return (
    <div className="home pad">
      <h1>{outline.driverSet.name}</h1>
      <p className="muted">{outline.driverSet.dn ?? "no DN recorded"}</p>
      <p>
        {outline.drivers.length} driver{outline.drivers.length === 1 ? "" : "s"}, {outline.library.policies.length + outline.library.resources.length} Library item
        {outline.library.policies.length + outline.library.resources.length === 1 ? "" : "s"}
        {validation && (
          <>
            {" "}
            · {validation.counts.error} error{validation.counts.error === 1 ? "" : "s"}, {validation.counts.warning} warning{validation.counts.warning === 1 ? "" : "s"}
          </>
        )}
      </p>
      <div className="cards">
        {outline.drivers.map((d) => (
          <button key={d.name} className="card" onClick={() => onSelect({ type: "flow", driver: d.name })}>
            <strong>{d.name}</strong>
            <span className="muted">{d.shimClass ?? "no shim class"}</span>
            <span>
              {d.policies.driver.length + d.policies.subscriber.length + d.policies.publisher.length} policies · {d.entitlements.length} entitlements · {d.forms.length} forms · {d.prds.length} PRDs
            </span>
          </button>
        ))}
      </div>
      <p className="muted small">
        The tree on disk is the only state. Edit here, with the <code>idm</code> CLI, or with an agent: this page follows the files.
      </p>
    </div>
  );
}
