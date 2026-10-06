import { useEffect, useState } from "react";
import { api } from "../api";
import type { GitStatus, Selection, Session, WorkspacesInfo } from "../types";

/**
 * The repository side of the workspace: which branch is open, what has changed since the last
 * commit, commit and push, update from the base branch, the pull-request link, and in hosted
 * mode who is signed in. Local mode shows it only when the tree sits in a git checkout.
 */
export function RepoBar({ session, revision, onWorkspaceChanged, onAddProject, onSelect }: { session: Session; revision: string; onWorkspaceChanged: () => void; onAddProject: () => void; onSelect: (s: Selection) => void }) {
  const [project, setProject] = useState<string>(session.project ?? "");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [info, setInfo] = useState<WorkspacesInfo | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [branch, setBranch] = useState("");
  const [open, setOpen] = useState(false);
  const NEW = "__new__";
  const [pick, setPick] = useState("");
  const hosted = session.mode === "hosted";

  const load = () => {
    if (session.workspace) {
      api.git
        .status()
        .then(setStatus)
        .catch(() => setStatus(null));
    }
    if (hosted) {
      api.workspaces(project || undefined).then(setInfo).catch(() => undefined);
    }
  };
  useEffect(load, [session.workspace, revision, hosted, project]);
  useEffect(() => setProject(session.project ?? ""), [session.project]);

  const run = (what: string, fn: () => Promise<{ text: string; ok: boolean }>) => {
    setBusy(what);
    setNote(null);
    fn()
      .then((r) => (setNote(r), load()))
      .catch((e: Error) => setNote({ ok: false, text: e.message }))
      .finally(() => setBusy(null));
  };
  const commit = (push: boolean) =>
    run(push ? "Committing and pushing…" : "Committing…", async () => {
      const r = await api.git.commit(message, push);
      if (r.committed) {
        setMessage("");
      }
      return { ok: true, text: r.committed ? `committed ${r.hash}${r.pushed ? " and pushed" : ""}` : (r.message ?? "nothing to commit") };
    });
  const update = () =>
    run("Updating…", async () => {
      const r = await api.git.update(status?.base ?? undefined);
      return { ok: r.merged, text: r.message };
    });
  const openBranch = () =>
    run("Opening…", async () => {
      await api.openWorkspace(branch.trim(), project || undefined);
      setOpen(false);
      onWorkspaceChanged();
      return { ok: true, text: `opened ${project ? project + " / " : ""}${branch.trim()}` };
    });

  if (!hosted && (!status || !status.repository)) {
    return null;
  }
  const changed = status?.changed?.length ?? 0;

  return (
    <div className="repobar" data-testid="repobar">
      {hosted && (info?.projects?.length ?? 0) > 0 && (
        <span className="projectpick">
          <select
            value={project}
            onChange={(e) => {
              if (e.target.value === "__add") {
                onAddProject();
                return;
              }
              setProject(e.target.value);
              setOpen(true);
              setPick("");
              setBranch("");
            }}
            title="Project: one tree with its repository"
            data-testid="repo-project"
          >
            {(info?.projects ?? []).map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
            <option value="__add">add a project…</option>
          </select>
        </span>
      )}
      {hosted && (
        <span className="branchpick">
          <strong>{session.branch ?? "no branch open"}</strong>
          <button className="link" onClick={() => setOpen(!open)} data-testid="repo-switch">
            {session.branch ? "switch" : "open a branch"}
          </button>
          {open && (
            <span className="addrow tight">
              <select
                value={pick}
                onChange={(e) => {
                  setPick(e.target.value);
                  setBranch(e.target.value === NEW ? "" : e.target.value);
                }}
                data-testid="repo-branch-select"
              >
                <option value="">branch…</option>
                {(info?.branches ?? []).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
                <option value={NEW}>new branch…</option>
              </select>
              {pick === NEW && <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={`name (starts from ${info?.base ?? "main"})`} spellCheck={false} autoFocus data-testid="repo-branch" />}
              <button onClick={openBranch} disabled={(!branch.trim() && !info?.inPlace) || busy !== null} data-testid="repo-open">
                Open
              </button>
            </span>
          )}
        </span>
      )}
      {status?.repository && (
        <>
          <span className="muted small" title={status.last ? `${status.last.hash} ${status.last.author}, ${status.last.when}: ${status.last.subject}` : ""}>
            {!hosted && <>on <strong>{status.branch}</strong> · </>}
            <button className={changed === 0 ? "link" : "pill warn dirty"} onClick={() => onSelect({ type: "changes", against: "head" })} title="What differs from the last commit, file by file" data-testid="repo-changes">
              {changed === 0 ? "nothing to commit" : `● ${changed} uncommitted file${changed === 1 ? "" : "s"}`}
            </button>
            {status.ahead ? (
              <>
                {" "}
                <button className="pill ahead" onClick={() => onSelect({ type: "changes", against: "upstream" })} title="Commits not pushed yet" data-testid="repo-ahead">
                  ↑ {status.ahead} to push
                </button>
              </>
            ) : ""}
            {status.behind ? ` · ${status.behind} behind ${status.upstream}` : ""}
            {status.base && status.base !== status.branch ? (
              <>
                {" · "}
                <button className="link" onClick={() => onSelect({ type: "changes", against: "base" })} title={`What a pull request against ${status.base} would carry`}>
                  vs {status.base}
                </button>
              </>
            ) : ""}
          </span>
          <input className="commitmsg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="commit message" disabled={changed === 0 || busy !== null} data-testid="repo-message" />
          <button onClick={() => commit(false)} disabled={changed === 0 || !message.trim() || busy !== null} data-testid="repo-commit">
            Commit
          </button>
          <button className="primary" onClick={() => commit(true)} disabled={(changed === 0 && !status.ahead) || (changed > 0 && !message.trim()) || busy !== null} data-testid="repo-push">
            {changed === 0 && status.ahead ? "Push" : "Commit & push"}
          </button>
          {status.base && status.base !== status.branch && (
            <button onClick={update} disabled={busy !== null} title={`git merge origin/${status.base}`}>
              Update from {status.base}
            </button>
          )}
          {status.compareUrl && (
            <a href={status.compareUrl} target="_blank" rel="noreferrer" className="link">
              Pull request ↗
            </a>
          )}
        </>
      )}
      {busy && <span className="muted small">{busy}</span>}
      {note && <span className={note.ok ? "ok-text small" : "err-text small"}>{note.text}</span>}
      <span className="spacer" />
      {hosted && (
        <span className="small">
          {session.user.name}
          <span className="muted"> · {session.user.deployer ? "deployer" : session.user.editor ? "editor" : "read-only"}</span> ·{" "}
          <a href="/auth/logout" className="link">
            sign out
          </a>
        </span>
      )}
    </div>
  );
}
