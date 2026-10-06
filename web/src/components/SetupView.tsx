import { useEffect, useState } from "react";
import { api } from "../api";
import type { Connections, SetupResult } from "../types";

type Way = "vault" | "project" | "export" | "existing" | "directory" | "clone";

/**
 * The first run of a hosted server: no repository yet, so where does the tree come from? Each
 * way ends with a repository the server then works from; the choice is kept for the next start.
 */
export function SetupView({ first, onDone, onConnections, onCancel }: { first: boolean; onDone: (project: string | null) => void; onConnections: () => void; onCancel?: () => void }) {
  const [way, setWay] = useState<Way | null>(null);
  const [project, setProject] = useState("");
  const [conns, setConns] = useState<Connections | null>(null);
  const [env, setEnv] = useState("");
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [base, setBase] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SetupResult | null>(null);

  useEffect(() => {
    api.connections
      .list()
      .then(setConns)
      .catch(() => setConns(null));
  }, [way]);

  const run = (what: string, fn: () => Promise<SetupResult>) => {
    setBusy(what);
    setError(null);
    fn()
      .then((r) => {
        setResult(r);
        setTimeout(() => onDone(r.project ?? null), 1200);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const ways: { id: Way; title: string; blurb: string }[] = [
    { id: "vault", title: "Export from an Identity Vault", blurb: "Connect to a vault and read its driver set into a new repository. The tree is then what the vault holds, ready to edit and deploy back." },
    { id: "project", title: "Import a Designer project", blurb: "Upload a zip of the project directory (or name a directory this server can see). Its driver set becomes the tree." },
    { id: "export", title: "Import a Designer export", blurb: "Upload an \"Export Configuration\" XML of a driver set or a driver." },
    { id: "existing", title: "Use an existing repository", blurb: "A git repository on this host: a bare one is cloned per branch; a checkout is used in place." },
    { id: "directory", title: "Use a directory of files", blurb: "A plain IDM-as-code tree on this host (driverset.xml at the top, or under tree/): it becomes a repository in place." },
    { id: "clone", title: "Clone a remote repository", blurb: "GitHub, GitLab, or any git remote, with a token if it needs one. Branches are cloned per person as they open them." },
  ];

  if (result) {
    return (
      <div className="pad setup">
        <h1>Ready</h1>
        <p className="ok-text">
          {result.repository ? `Repository: ${result.repository}` : result.inPlace ? `Working in place in ${result.inPlace}` : "Done"}
          {result.drivers !== undefined ? ` — ${result.drivers} driver${result.drivers === 1 ? "" : "s"}` : ""}
          {result.tree ? ` (tree at ${result.tree})` : ""}
        </p>
        {result.notes?.map((n, i) => (
          <p key={i} className="muted small">
            {n}
          </p>
        ))}
        <p className="muted">Opening the workbench…</p>
      </div>
    );
  }

  return (
    <div className="pad setup" data-testid="setup">
      <h1>{first ? "Where does the tree come from?" : "Add a project"}</h1>
      <p className="muted">
        {first ? "This server has no project yet. " : "A project is one tree with its repository; this server holds any number. "}
        Pick one way; it is remembered for next time.
        {onCancel && (
          <>
            {" "}
            <button className="link" onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
      </p>
      <label className="field">
        <em>Project name (default: taken from the source)</em>
        <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="customer-a" spellCheck={false} data-testid="setup-project" />
      </label>
      <div className="cards">
        {ways.map((w) => (
          <button key={w.id} className={"card" + (way === w.id ? " active" : "")} onClick={() => (setWay(w.id), setError(null))} data-testid={"setup-" + w.id}>
            <strong>{w.title}</strong>
            <span className="muted small">{w.blurb}</span>
          </button>
        ))}
      </div>
      {error && <div className="banner error">{error}</div>}

      {way === "vault" && (
        <section className="block">
          <h3>Export from an Identity Vault</h3>
          {conns && conns.environments.length > 0 ? (
            <div className="addrow">
              <select value={env} onChange={(e) => setEnv(e.target.value)} data-testid="setup-env">
                <option value="">environment…</option>
                {conns.environments.map((e) => (
                  <option key={e.name} value={e.name} disabled={!e.ready}>
                    {e.name} ({e.tier}){e.ready ? "" : " — incomplete"}
                  </option>
                ))}
              </select>
              <button className="primary" disabled={!env || busy !== null} onClick={() => run("Reading the vault…", () => api.setup.vault(project, env))} data-testid="setup-vault-go">
                Read the driver set
              </button>
              <button className="link" onClick={onConnections}>
                add or edit a connection
              </button>
            </div>
          ) : (
            <p>
              No vault connection yet.{" "}
              <button className="link" onClick={onConnections}>
                Set one up
              </button>{" "}
              (URL, bind DN, driver set, password), then come back here.
            </p>
          )}
        </section>
      )}

      {(way === "project" || way === "export") && (
        <section className="block">
          <h3>{way === "project" ? "Import a Designer project" : "Import a Designer export"}</h3>
          <div className="addrow">
            <input type="file" accept={way === "project" ? ".zip" : ".xml"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="setup-file" />
            <button className="primary" disabled={!file || busy !== null} onClick={() => run("Importing…", () => api.setup.upload(project, way, file!))} data-testid="setup-upload-go">
              Import {file ? file.name : ""}
            </button>
          </div>
          {way === "project" && (
            <div className="addrow">
              <span className="muted small">or a project directory this server can see:</span>
              <input className="wide" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/the/designer/project" spellCheck={false} />
              <button disabled={!path.trim() || busy !== null} onClick={() => run("Importing…", () => api.setup.project(project, path))}>
                Import
              </button>
            </div>
          )}
          <p className="muted small">{way === "project" ? "Zip the project directory (the one with .project and Model/). Drivers, policies, GCVs, entitlements, forms, PRDs and the AppConfig come across; the Designer project stays as it is." : "The XML Designer writes with Export Configuration, for a driver set or a single driver."}</p>
        </section>
      )}

      {(way === "existing" || way === "directory") && (
        <section className="block">
          <h3>{way === "existing" ? "Use an existing repository" : "Use a directory of files"}</h3>
          <div className="addrow">
            <input className="wide" value={path} onChange={(e) => setPath(e.target.value)} placeholder={way === "existing" ? "/path/to/repo.git or /path/to/a/checkout" : "/path/to/the/tree"} spellCheck={false} data-testid="setup-path" />
            <button className="primary" disabled={!path.trim() || busy !== null} onClick={() => run("Checking…", () => (way === "existing" ? api.setup.existing(project, path) : api.setup.directory(project, path)))} data-testid="setup-path-go">
              Use it
            </button>
          </div>
          <p className="muted small">In a container the path is inside the container: mount the directory first (the single-user layout mounts the directory it runs from).</p>
        </section>
      )}

      {way === "clone" && (
        <section className="block">
          <h3>Clone a remote repository</h3>
          <div className="attrs">
            <label className="field wide">
              <em>Repository URL</em>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/org/idm-config.git or git@github.com:org/idm-config.git" spellCheck={false} data-testid="setup-url" />
            </label>
            <label className="field">
              <em>Token (https remotes that need one; kept in the server's configuration)</em>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            </label>
            <label className="field">
              <em>Base branch (default: main or master)</em>
              <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="main" spellCheck={false} />
            </label>
          </div>
          <button className="primary" disabled={!url.trim() || busy !== null} onClick={() => run("Cloning…", () => api.setup.clone(project, url, token, base))} data-testid="setup-clone-go">
            Clone
          </button>
          <p className="muted small">A git@ remote uses the deploy key named in the configuration (repo.sshKey). The tree must sit at the top of the base branch or under tree/.</p>
        </section>
      )}
      {busy && <p className="muted">{busy}</p>}
    </div>
  );
}
