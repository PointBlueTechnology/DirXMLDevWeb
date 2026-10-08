import { useCallback, useEffect, useState } from "react";
import { ApiError, api, followTree, setCsrf, takeToken } from "./api";
import { RepoBar } from "./components/RepoBar";
import type { ArtifactNode, OpCall, Outline, Selection, Session, Validation } from "./types";
import { ConfigEditor } from "./components/ConfigEditor";
import { OverridesView } from "./components/OverridesView";
import { OutlineTree } from "./components/OutlineTree";
import { ArtifactView } from "./components/ArtifactView";
import { FileView } from "./components/FileView";
import { FlowView } from "./components/FlowView";
import { OperationsView } from "./components/OperationsView";
import { AuditView } from "./components/AuditView";
import { ProjectsView } from "./components/ProjectsView";
import { SEVERITIES, ValidationPanel, ValidationSummary } from "./components/ValidationPanel";
import type { Severity } from "./components/ValidationPanel";
import { TraceFilesView } from "./components/TraceFilesView";
import { TraceViewer } from "./components/TraceViewer";
import { VaultView } from "./components/VaultView";
import { SimView } from "./components/SimView";
import { PrdView } from "./components/PrdView";
import { FormView } from "./components/FormView";
import { RolesView } from "./components/RolesView";
import { PackagesView } from "./components/PackagesView";
import { ConnectionsView } from "./components/ConnectionsView";
import { EntitlementView } from "./components/EntitlementView";
import { SetupView } from "./components/SetupView";
import { NewItemView } from "./components/NewItemView";
import { ChangesView } from "./components/ChangesView";
import { DriverSetView } from "./components/DriverSetView";
import { isUserApplication } from "./drivers";
import { fromHash, toHash } from "./route";

export function App() {
  const [token] = useState(() => takeToken());
  const [session, setSession] = useState<Session | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  // the findings list is optional (the counts always show in the top bar) and filtered by severity;
  // both choices are this browser's
  const [problemsHidden, setProblemsHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem("idmweb.validation.hidden") === "1";
    } catch {
      return false;
    }
  });
  const [severities, setSeverities] = useState<Set<Severity>>(() => {
    try {
      const raw = localStorage.getItem("idmweb.validation.severities");
      if (raw) {
        const list = JSON.parse(raw) as string[];
        return new Set(SEVERITIES.filter((s) => list.includes(s)));
      }
    } catch {
      // no storage: every severity
    }
    return new Set(SEVERITIES);
  });
  const remember = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // per-viewer convenience only
    }
  };
  const hideProblems = (hidden: boolean) => {
    setProblemsHidden(hidden);
    remember("idmweb.validation.hidden", hidden ? "1" : "0");
  };
  const showSeverities = (set: Set<Severity>) => {
    setSeverities(set);
    remember("idmweb.validation.severities", JSON.stringify([...set]));
  };
  // a bubble in the top bar: open the list at that severity alone; the word: toggle the list, unfiltered
  const pickSeverity = (only: Severity | null) => {
    if (only === null) {
      if (!problemsHidden && severities.size === SEVERITIES.length) {
        hideProblems(true);
        return;
      }
      showSeverities(new Set(SEVERITIES));
    } else {
      showSeverities(new Set([only]));
    }
    hideProblems(false);
  };
  const [revision, setRevision] = useState<string>("");
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelectionState] = useState<Selection>(() => fromHash(window.location.hash) ?? { type: "home" });
  // every selection is an entry in the browser's history: Back and Forward move between views
  const setSelection = useCallback((s: Selection) => {
    setSelectionState(s);
    const hash = toHash(s);
    if (window.location.hash !== hash) {
      history.pushState(s, "", hash);
    }
  }, []);
  useEffect(() => {
    const onPop = () => {
      // a link with the token appended (a pop-out opened in the same tab): take it out of the address first
      takeToken();
      setSelectionState(fromHash(window.location.hash) ?? { type: "home" });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [opNames, setOpNames] = useState<Set<string>>(new Set());
  const [noWorkspace, setNoWorkspace] = useState(false);
  // bumped when the workspace changes: the event stream is per workspace and must be opened again
  const [streamKey, setStreamKey] = useState(0);
  const [addingProject, setAddingProject] = useState(false);
  // what the page is waiting for, when it is: opening a branch clones it on the server, then the tree
  // is read and validated — seconds on a large driver set, so the wait is said, not hidden
  const [loading, setLoading] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      // the outline first, so the page is usable while the (slower) validation runs
      setLoading((l) => l ?? "Reading the tree…");
      const o = await api.outline();
      setOutline(o);
      setRevision(o.revision);
      setError(null);
      setNoWorkspace(false);
      setLoading("Validating…");
      const v = await api.validation();
      setValidation(v);
      setLoading(null);
    } catch (e) {
      setLoading(null);
      if (e instanceof ApiError && e.noWorkspace) {
        setNoWorkspace(true);
        setError(null);
        return;
      }
      setError(e instanceof ApiError && e.status === 403 ? "This session is not authorised. Open the URL the server printed (it carries the token)." : String(e instanceof Error ? e.message : e));
    }
  }, []);

  const loadSession = useCallback(
    () =>
      api
        .session()
        .then((s) => {
          setCsrf(s.csrf);
          setSession(s);
          return s;
        })
        .catch(() => null),
    [],
  );

  useEffect(() => {
    // local mode needs the printed token; hosted mode has a cookie and no token at all
    if (!token && !document.cookie.includes("idmweb_session") && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      // a hosted page: /api/session either works (cookie) or redirects to sign-in
    } else if (!token && !document.cookie.includes("idmweb_session")) {
      setError("No session token. Open the URL that `bin/idmweb serve` printed; it ends in #token=…");
    }
    void loadSession().then(() => reload());
    api
      .catalog()
      .then((c) => setOpNames(new Set(c.operations.map((o) => o.name))))
      .catch(() => undefined);
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
  }, [token, reload, loadSession, streamKey]);

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
        setSelection({ type: "driverset" });
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

  if (selection.type === "trace" && selection.popout) {
    // a pop-out window: the trace viewer alone, full height — live for an environment, or a trace file
    return (
      <div className="app popout" data-testid="trace-popout">
        <TraceViewer env={selection.env} file={selection.file} drivers={outline?.drivers.map((d) => d.name) ?? []} outline={outline} onSelect={setSelection} onOpen={open} popout />
      </div>
    );
  }
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">DirXMLDevWeb</span>
          {outline && <span className="set">{outline.driverSet.name}</span>}
        </div>
        <div className="meta">
          {session && !noWorkspace && !addingProject && <ValidationSummary validation={validation} open={!problemsHidden} onPick={pickSeverity} />}
          {session?.tree && <span title={session.tree}>{shorten(session.tree)}</span>}
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
      {session && (
        <RepoBar
          session={session}
          revision={revision}
          onWorkspaceChanged={() => {
            setLoading("Reading the tree…");
            void loadSession().then(() => {
              setStreamKey((k) => k + 1);
              return reload();
            });
            setSelection({ type: "home" });
          }}
          onBusy={(what) => setLoading(what)}
          onAddProject={() => setAddingProject(true)}
          onSelect={setSelection}
        />
      )}
      {addingProject && session && selection.type === "connections" && (
        <div className="setupconn">
          <p className="pad-x small">
            <button className="link" onClick={() => setSelection({ type: "home" })}>
              ← back to adding the project
            </button>
          </p>
          <ConnectionsView initialEnv={null} deployer={session?.user.deployer ?? true} />
        </div>
      )}
      {addingProject && session && selection.type !== "connections" && (
        <SetupView
          first={false}
          onCancel={() => setAddingProject(false)}
          onDone={(project) => {
            setAddingProject(false);
            setLoading("Opening main — cloning it on the server…");
            void api.openWorkspace("main", project ?? undefined).then(() => loadSession()).then(() => {
              setStreamKey((k) => k + 1);
              setSelection({ type: "home" });
              setLoading("Reading the tree…");
              return reload();
            }).catch(() => {
              setLoading(null);
              return loadSession();
            });
          }}
          onConnections={() => setSelection({ type: "connections" })}
        />
      )}
      {noWorkspace && session?.setup && selection.type !== "connections" && (
        <SetupView
          first
          onDone={(project) => {
            void loadSession().then((s) => {
              if (s && !s.setup) {
                setLoading("Opening main — cloning it on the server…");
                return api.openWorkspace("main", project ?? undefined).then(() => loadSession()).then(() => {
                  setStreamKey((k) => k + 1);
                  setLoading("Reading the tree…");
                  return reload();
                }).catch(() => setLoading(null));
              }
              return undefined;
            });
          }}
          onConnections={() => setSelection({ type: "connections" })}
        />
      )}
      {noWorkspace && session?.setup && selection.type === "connections" && (
        <div className="setupconn">
          <p className="pad-x small">
            <button className="link" onClick={() => setSelection({ type: "home" })}>
              ← back to setup
            </button>
          </p>
          <ConnectionsView initialEnv={null} deployer={session?.user.deployer ?? true} />
        </div>
      )}
      {noWorkspace && session && !session.setup && !addingProject && (
        <div className="pad">
          <h1>Open a branch</h1>
          <p className="muted">You are signed in as {session.user.name}. Pick the branch to work on; a new name starts a branch from the base.</p>
          <p className="muted small">Use the bar above.</p>
        </div>
      )}
      {loading && (
        <div className="loading" role="status" aria-live="polite" data-testid="loading">
          <span className="spinner" />
          <span>{loading}</span>
        </div>
      )}
      <div className={problemsHidden ? "body problems-hidden" : "body"} style={noWorkspace || addingProject ? { display: "none" } : undefined}>
        <nav className="sidebar">
          <button className={selection.type === "vault" ? "navbtn active" : "navbtn"} onClick={() => setSelection({ type: "vault" })}>
            Vault
          </button>
          <button className={selection.type === "traces" ? "navbtn active" : "navbtn"} onClick={() => setSelection({ type: "traces" })} title="Recordings of the live trace and uploaded trace files, in the viewer">
            Trace files
          </button>
          <button className={selection.type === "simulator" ? "navbtn active" : "navbtn"} onClick={() => setSelection({ type: "simulator" })}>
            Simulator
          </button>
          <button className={selection.type === "packages" ? "navbtn active" : "navbtn"} onClick={() => setSelection({ type: "packages" })}>
            Packages
          </button>
          <button className={selection.type === "connections" ? "navbtn active" : "navbtn"} onClick={() => setSelection({ type: "connections" })}>
            Connections
          </button>
          {outline?.drivers.some(isUserApplication) && (
            <button className={selection.type === "roles" ? "navbtn active" : "navbtn"} onClick={() => setSelection({ type: "roles" })}>
              Roles and resources
            </button>
          )}
          {outline ? <OutlineTree outline={outline} selection={selection} onSelect={setSelection} /> : <p className="muted pad">Loading the tree…</p>}
          {session?.mode === "hosted" && session.user.deployer && (
            <>
              <button className={selection.type === "projects" ? "navbtn active advanced" : "navbtn advanced"} onClick={() => setSelection({ type: "projects" })} title="The projects this server holds: archive or remove one">
                Projects
              </button>
              <button className={selection.type === "audit" ? "navbtn active advanced" : "navbtn advanced"} onClick={() => setSelection({ type: "audit" })} title="Who did what on this server">
                Audit log
              </button>
            </>
          )}
          <button className={selection.type === "operations" ? "navbtn active advanced" : "navbtn advanced"} onClick={() => setSelection({ type: "operations" })} title="Every operation the core registers, as a form: what an agent runs, and what the editors above run for you">
            Operations (advanced)
          </button>
        </nav>
        <main className="main">
          {selection.type === "home" && <Home outline={outline} validation={validation} onSelect={setSelection} />}
          {selection.type === "flow" && <FlowView key={selection.driver} driver={selection.driver} revision={revision} outline={outline} onOpen={open} onOpenFile={(file) => setSelection({ type: "file", file })} onSaved={reload} />}
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
          {selection.type === "driverset" && outline && <DriverSetView key={selection.tab ?? "overview"} outline={outline} revision={revision} canOverride={opNames.has("override.set")} linkable={artifacts} initialTab={selection.tab} onOpen={open} onSelect={setSelection} onSaved={reload} />}
          {selection.type === "overrides" && <OverridesView revision={revision} canEdit={opNames.has("override.set")} onSaved={reload} />}
          {selection.type === "operations" && <OperationsView onDone={reload} />}
          {selection.type === "prd" && <PrdView key={selection.driver + "/" + selection.name} driver={selection.driver} name={selection.name} revision={revision} onSelect={setSelection} onSaved={reload} />}
          {selection.type === "form" && <FormView key={selection.driver + "/" + selection.name} driver={selection.driver} name={selection.name} revision={revision} onSelect={setSelection} onSaved={reload} />}
          {selection.type === "roles" && <RolesView revision={revision} onSaved={reload} />}
          {selection.type === "audit" && <AuditView />}
          {selection.type === "projects" && <ProjectsView />}
          {selection.type === "traces" && <TraceFilesView onSelect={setSelection} />}
          {selection.type === "trace" && !selection.popout && <TraceViewer key={selection.file ?? selection.env ?? ""} env={selection.env} file={selection.file} drivers={outline?.drivers.map((d) => d.name) ?? []} outline={outline} onSelect={setSelection} onOpen={open} />}
          {selection.type === "changes" && <ChangesView key={selection.against ?? "head"} initial={selection.against ?? "head"} revision={revision} onSelect={setSelection} />}
          {selection.type === "new" && outline && <NewItemView key={selection.what + (selection.driver ?? "")} what={selection.what} driver={selection.driver} outline={outline} onSelect={setSelection} onSaved={reload} />}
          {selection.type === "entitlement" && <EntitlementView key={selection.file} driver={selection.driver} name={selection.name} file={selection.file} revision={revision} onSelect={setSelection} onSaved={reload} />}
          {selection.type === "connections" && <ConnectionsView key={selection.env ?? ""} initialEnv={selection.env ?? null} deployer={session?.user.deployer ?? true} />}
          {selection.type === "packages" && outline && <PackagesView drivers={outline.drivers.map((d) => d.name)} revision={revision} onSaved={reload} onOpen={open} />}
          {selection.type === "simulator" && outline && <SimView drivers={outline.drivers.map((d) => d.name)} revision={revision} />}
          {selection.type === "vault" && outline && <VaultView drivers={outline.drivers.map((d) => d.name)} revision={revision} outline={outline} onOpen={open} onSelect={setSelection} onSaved={reload} />}
        </main>
        {!problemsHidden && (
          <aside className="problems">
            <ValidationPanel
              validation={validation}
              show={severities}
              onToggle={(s) => {
                const next = new Set(severities);
                if (next.has(s)) {
                  next.delete(s);
                } else {
                  next.add(s);
                }
                showSeverities(next);
              }}
              onOpen={open}
              onHide={() => hideProblems(true)}
            />
          </aside>
        )}
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
            <span className="muted" title={d.shimClass ?? undefined}>
              {d.shimClass ?? "no shim class"}
            </span>
            <span>
              {d.policies.driver.length + d.policies.subscriber.length + d.policies.publisher.length} policies · {d.entitlements.length} entitlements
              {isUserApplication(d) ? ` · ${d.forms.length} forms · ${d.prds.length} PRDs` : ""}
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
