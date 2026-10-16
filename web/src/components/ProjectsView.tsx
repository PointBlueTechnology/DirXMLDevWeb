import { useEffect, useState } from "react";
import { api } from "../api";
import type { ProjectArchive, ProjectRepository, RepositoryCheck } from "../types";
import { GitTokensPanel } from "./GitTokensPanel";

/**
 * The projects a hosted server holds (deployers, #76): archive one — its repository as a git
 * bundle, its workspaces and recordings moved aside, the project forgotten — or just remove it;
 * and the archives made so far, with the bundle to download.
 */
export function ProjectsView({ deployer = true }: { deployer?: boolean }) {
  const [projects, setProjects] = useState<{ name: string; repository: string | null; inPlace: string | null; base: string; tree: string }[] | null>(null);
  const [archives, setArchives] = useState<{ dir: string; archives: ProjectArchive[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<{ name: string; what: "archive" | "remove"; typed: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [repoOf, setRepoOf] = useState<string | null>(null);
  const [helpers, setHelpers] = useState("");

  const load = () => {
    Promise.all([api.setup.state(), deployer ? api.setup.archives() : Promise.resolve(null)])
      .then(([s, a]) => {
        setProjects((s as unknown as { projects: typeof projects }).projects ?? []);
        setArchives(a);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    api.connections
      .list()
      .then((c) => setHelpers(c.helpers))
      .catch(() => undefined);
  };
  useEffect(load, []);

  const go = () => {
    if (!acting) {
      return;
    }
    setBusy(acting.what);
    setNote(null);
    (acting.what === "archive" ? api.setup.archive(acting.name).then((r) => `${r.archived} archived as ${r.name}: ${r.bundle} (${fmt(r.bytes)}), ${r.moved.length} director${r.moved.length === 1 ? "y" : "ies"} moved aside`) : api.setup.remove(acting.name).then((r) => `${r.removed} removed from the configuration; its files stay on disk`))
      .then((n) => {
        setNote(n);
        setActing(null);
        load();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  return (
    <div className="view projects">
      <div className="viewhead">
        <div>
          <div className="kicker">Hosted server</div>
          <h2>Projects</h2>
        </div>
      </div>
      <div className="pad scroll">
        {error && <div className="banner error">{error}</div>}
        {note && <div className="banner" data-testid="projects-note">{note}</div>}
        {projects && (
          <table className="grid" data-testid="projects-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Repository</th>
                <th>Base</th>
                <th>Tree</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.name} className={acting?.name === p.name ? "selected" : ""}>
                  <td>
                    <code>{p.name}</code>
                  </td>
                  <td className="small">{p.inPlace ? `${p.inPlace} (in place)` : (p.repository ?? "—")}</td>
                  <td className="small">{p.base}</td>
                  <td className="small">{p.tree}</td>
                  <td className="right">
                    <button onClick={() => setRepoOf(repoOf === p.name ? null : p.name)} data-testid={"project-repository-" + p.name}>
                      Repository
                    </button>{" "}
                    {deployer && (<>
                    <button disabled={busy !== null} onClick={() => setActing({ name: p.name, what: "archive", typed: "" })} title="The repository as a git bundle, the workspaces and recordings moved aside, the project forgotten" data-testid={"project-archive-" + p.name}>
                      Archive…
                    </button>{" "}
                    <button disabled={busy !== null} onClick={() => setActing({ name: p.name, what: "remove", typed: "" })} title="Forget the project; its files stay on disk" data-testid={"project-remove-" + p.name}>
                      Remove…
                    </button>
                    </>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {projects && projects.length === 0 && <p className="muted">No projects.</p>}
        {repoOf && <RepositoryPanel key={repoOf} project={repoOf} deployer={deployer} onChanged={load} />}
        <h3>Your Git tokens</h3>
        <GitTokensPanel helpers={helpers} references={deployer} />
        {acting && (
          <section className="block" data-testid="project-confirm">
            <h3>{acting.what === "archive" ? `Archive ${acting.name}` : `Remove ${acting.name}`}</h3>
            <p className="small">
              {acting.what === "archive"
                ? "The repository is written as a git bundle (complete history), then the project's workspaces, every person's recordings, a repository the server made for it and its token move under the archive directory, and the project leaves the configuration. Nothing is deleted; the bundle can be downloaded below afterwards. Anyone with it open loses the workspace."
                : "Only the configuration entry goes. Workspaces, recordings and a server-made repository stay on disk and are named at the next start as unclaimed. Use Archive to keep everything together."}
            </p>
            <div className="addrow">
              <input value={acting.typed} onChange={(e) => setActing({ ...acting, typed: e.target.value })} placeholder={`type ${acting.name} to confirm`} spellCheck={false} autoComplete="off" data-testid="project-confirm-name" />
              <button className={acting.what === "archive" ? "primary" : "danger"} disabled={acting.typed !== acting.name || busy !== null} onClick={go} data-testid="project-confirm-go">
                {busy ? (acting.what === "archive" ? "Archiving…" : "Removing…") : acting.what === "archive" ? "Archive" : "Remove"}
              </button>
              <button onClick={() => setActing(null)} disabled={busy !== null}>
                Cancel
              </button>
            </div>
          </section>
        )}
        <h3>Archives</h3>
        {archives && <p className="muted small">Under {archives.dir}. An archive stays until the operator removes the directory; <code>git clone &lt;bundle&gt;</code> restores the repository anywhere.</p>}
        {archives && archives.archives.length > 0 ? (
          <table className="grid" data-testid="archives-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>When</th>
                <th>By</th>
                <th>Repository</th>
                <th>Bundle</th>
                <th>Moved aside</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {archives.archives.map((a) => (
                <tr key={a.name}>
                  <td>
                    <code>{a.project}</code>
                    <div className="muted small">{a.name}</div>
                  </td>
                  <td className="small">{(a.archivedAt ?? "").replace("T", " ").slice(0, 16)}</td>
                  <td className="small">{a.by || "—"}</td>
                  <td className="small">{a.repository || "—"}</td>
                  <td className="small">{a.bundle ? `${a.bundle} (${fmt(a.bytes ?? 0)})` : "—"}</td>
                  <td className="small muted">{a.moved.length === 0 ? "nothing" : a.moved.join("; ")}</td>
                  <td className="right">{a.bundle && <a className="button" href={api.setup.archiveFileUrl(a.name)} download>Download bundle</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          archives && <p className="muted">No archives yet.</p>
        )}
      </div>
    </div>
  );
}

function fmt(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * A project's repository (docs/connections-ui.md): where it pushes, its base branch, whether it has a token; for a
 * deployer, Push this project to a remote… (a repository the server made) or Change remote… (one that moved).
 */
function RepositoryPanel({ project, deployer, onChanged }: { project: string; deployer: boolean; onChanged: () => void }) {
  const [repo, setRepo] = useState<ProjectRepository | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [typed, setTyped] = useState("");
  const [check, setCheck] = useState<RepositoryCheck | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const load = () =>
    api.setup
      .repository(project)
      .then((r) => (setRepo(r), setError(null)))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);
  const run = (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    fn()
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  if (!repo) {
    return error ? <div className="banner error">{error}</div> : <p className="muted">Reading the repository…</p>;
  }
  const doCheck = () =>
    run("Checking the remote…", async () => {
      setCheck(null);
      if (!url.trim()) {
        throw new Error("Enter the remote's address");
      }
      setCheck(await api.setup.repositoryCheck(project, url.trim(), token));
    });
  const doMove = () =>
    run("Moving: copying every branch and tag, then switching…", async () => {
      const r = await api.setup.repositoryMove(project, url.trim(), token, typed);
      setDone(`${project} now pushes to ${r.pushesTo}: ${r.branches} branch(es) and ${r.tags} tag(s) copied, ${r.workspaces} workspace(s) switched. The old repository is kept at ${r.kept}.`);
      setOpen(false);
      setToken("");
      void load();
      onChanged();
    });
  const doChange = () =>
    run("Changing the remote…", async () => {
      const r = await api.setup.repositoryChange(project, url.trim(), token, typed);
      setDone(`${project} now pushes to ${r.pushesTo}; ${r.workspaces} workspace(s) switched.`);
      setOpen(false);
      setToken("");
      void load();
      onChanged();
    });
  return (
    <section className="block" data-testid="project-repository">
      <h3>Repository: {project}</h3>
      <table className="grid">
        <tbody>
          <tr>
            <td className="muted small">Pushes to</td>
            <td data-testid="repo-pushes-to">
              {repo.inPlace ? "a checkout on this server, used in place" : repo.serverMade ? "a repository on this server" : /^https?:\/\//.test(repo.pushesTo ?? "") ? <a href={repo.pushesTo!.replace(/\.git$/, "")} target="_blank" rel="noreferrer">{repo.pushesTo}</a> : <code>{repo.pushesTo}</code>}
            </td>
          </tr>
          <tr>
            <td className="muted small">Base branch</td>
            <td>
              <code>{repo.base}</code> <span className="muted small">where new branches start, and what pull requests target</span>
            </td>
          </tr>
          <tr>
            <td className="muted small">Project token</td>
            <td>{repo.tokenSet ? <span className="pill ok">set</span> : <span className="muted">none</span>}</td>
          </tr>
        </tbody>
      </table>
      {done && <div className="banner" data-testid="repo-done">{done}</div>}
      {deployer && !repo.inPlace && !open && (
        <button onClick={() => (setOpen(true), setDone(null), setCheck(null), setTyped(""))} data-testid="repo-open-move">
          {repo.serverMade ? "Push this project to a remote…" : "Change remote…"}
        </button>
      )}
      {deployer && open && (
        <div className="block" data-testid="repo-move">
          <h4>{repo.serverMade ? "Push this project to a remote" : "Change remote"}</h4>
          <p className="muted small">
            {repo.serverMade
              ? "An empty repository on GitHub, GitLab or any git host. Every branch and tag is copied, then the project and every workspace push there; the repository on this server is kept, renamed."
              : "The same repository at a new address (a renamed organization, a new host). It must hold the base branch."}
          </p>
          <div className="attrs">
            <label className="field wide">
              <em>Remote</em>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/org/prod-idm.git" spellCheck={false} data-testid="repo-url" />
            </label>
            <label className="field wide">
              <em>Token that can push{repo.serverMade ? "" : " (leave empty to keep the current one)"}</em>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="new-password" data-testid="repo-token" />
              <span className="muted small">Kept on this server, readable by it only; never shown again.</span>
            </label>
          </div>
          {repo.serverMade && (
            <div className="addrow">
              <button onClick={doCheck} disabled={busy !== null} data-testid="repo-check">
                Check
              </button>
            </div>
          )}
          {check && (
            <div className={check.ok ? "banner" : "banner error"} data-testid="repo-check-result">
              {check.message} {check.ok && `${check.branches} branch(es) and ${check.tags} tag(s) will be copied.`}
              {check.unpushed.length > 0 && (
                <>
                  <div className="small">Not pushed yet. Nothing is lost: each workspace switches with the project, so this work can be pushed afterwards.</div>
                  <ul className="plain small">
                    {check.unpushed.map((u) => (
                      <li key={u.person + u.branch}>
                        {u.person}: <code>{u.branch}</code>
                        {u.ahead > 0 ? `, ${u.ahead} commit(s) not pushed` : ""}
                        {u.uncommitted > 0 ? `, ${u.uncommitted} uncommitted file(s)` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {(!repo.serverMade || check?.ok) && (
            <div className="addrow">
              <span className="small">
                Type <code>{project}</code> to {repo.serverMade ? "move it" : "change its remote"}:
              </span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} data-testid="repo-confirm" />
              <button className="danger" onClick={repo.serverMade ? doMove : doChange} disabled={busy !== null || typed !== project || !url.trim()} data-testid="repo-go">
                {repo.serverMade ? "Move" : "Change remote"}
              </button>
            </div>
          )}
          <div className="addrow">
            <button onClick={() => setOpen(false)}>Cancel</button>
            {busy && <span className="muted">{busy}</span>}
          </div>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
    </section>
  );
}
