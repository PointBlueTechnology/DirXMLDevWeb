import { useEffect, useState } from "react";
import { api } from "../api";
import type { ProjectArchive } from "../types";

/**
 * The projects a hosted server holds (deployers, #76): archive one — its repository as a git
 * bundle, its workspaces and recordings moved aside, the project forgotten — or just remove it;
 * and the archives made so far, with the bundle to download.
 */
export function ProjectsView() {
  const [projects, setProjects] = useState<{ name: string; repository: string | null; inPlace: string | null; base: string; tree: string }[] | null>(null);
  const [archives, setArchives] = useState<{ dir: string; archives: ProjectArchive[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<{ name: string; what: "archive" | "remove"; typed: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = () => {
    Promise.all([api.setup.state(), api.setup.archives()])
      .then(([s, a]) => {
        setProjects((s as unknown as { projects: typeof projects }).projects ?? []);
        setArchives(a);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
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
                    <button disabled={busy !== null} onClick={() => setActing({ name: p.name, what: "archive", typed: "" })} title="The repository as a git bundle, the workspaces and recordings moved aside, the project forgotten" data-testid={"project-archive-" + p.name}>
                      Archive…
                    </button>{" "}
                    <button disabled={busy !== null} onClick={() => setActing({ name: p.name, what: "remove", typed: "" })} title="Forget the project; its files stay on disk" data-testid={"project-remove-" + p.name}>
                      Remove…
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {projects && projects.length === 0 && <p className="muted">No projects.</p>}
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
