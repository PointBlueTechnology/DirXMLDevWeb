import { useEffect, useState } from "react";
import { GIT_CHANGED, api } from "../api";
import type { GitStatus, PullRequestInfo, Selection, Session, WorkspacesInfo } from "../types";
import { ConflictDialog } from "./ConflictDialog";
import { MergeDialog } from "./MergeDialog";
import { MergedBranchesDialog } from "./MergedBranchesDialog";
import { PullRequestDialog } from "./PullRequestDialog";

/**
 * The repository side of the workspace: which branch is open, what has changed since the last
 * commit, commit and push, update from the base branch, the pull-request link, and in hosted
 * mode who is signed in. Local mode shows it only when the tree sits in a git checkout.
 */
export function RepoBar({ session, revision, onWorkspaceChanged, onBusy, onAddProject, onSelect }: { session: Session; revision: string; onWorkspaceChanged: () => void; onBusy: (what: string | null) => void; onAddProject: () => void; onSelect: (s: Selection) => void }) {
  const [project, setProject] = useState<string>(session.project ?? "");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [info, setInfo] = useState<WorkspacesInfo | null>(null);
  const [message, setMessage] = useState("");
  // a suggested message from a change made elsewhere on the page (#67: "Capture drift from <env>"); never over one being typed
  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<string>).detail;
      if (typeof m === "string") {
        setMessage((cur) => (cur.trim() ? cur : m));
      }
    };
    window.addEventListener("idmweb:suggest-commit", on);
    return () => window.removeEventListener("idmweb:suggest-commit", on);
  }, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [branch, setBranch] = useState("");
  const [open, setOpen] = useState(false);
  const NEW = "__new__";
  const [pick, setPick] = useState("");
  const hosted = session.mode === "hosted";
  // #35: the branch's request on the provider. Asked when the branch, its upstream or what is unpushed
  // changes, not on every tree change: each ask is a call to the provider (or its CLI).
  const [pr, setPr] = useState<PullRequestInfo | null>(null);
  const [prOpen, setPrOpen] = useState(false);
  // docs/git-workflow.md: a repository with no GitHub or GitLab in front of it is merged on this page
  const [mergeOpen, setMergeOpen] = useState(false);
  // an update that conflicted: settled on the page
  const [conflictWith, setConflictWith] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [cleanup, setCleanup] = useState(false);
  // hosted: the provider's API; a local install: gh or glab (P3)
  const prKey = status?.repository && status.base && status.branch !== status.base ? `${status.branch}|${status.upstream ?? ""}|${status.ahead ?? 0}` : "";
  useEffect(() => {
    if (!prKey) {
      setPr(null);
      return;
    }
    let live = true;
    api.git
      .pullRequest()
      .then((r) => live && setPr(r))
      .catch(() => live && setPr(null));
    return () => {
      live = false;
    };
  }, [prKey]);

  // resolves once the bar shows the new state, so a commit's spinner stays up until the count is right
  const load = () =>
    Promise.all([
      session.workspace
        ? api.git
            .status()
            .then(setStatus)
            .catch(() => setStatus(null))
        : undefined,
      hosted ? api.workspaces(project || undefined).then(setInfo).catch(() => undefined) : undefined,
    ]).then(() => undefined);
  useEffect(() => void load(), [session.workspace, revision, hosted, project]);
  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener(GIT_CHANGED, onChanged);
    return () => window.removeEventListener(GIT_CHANGED, onChanged);
  }, [session.workspace, hosted, project]);
  useEffect(() => setProject(session.project ?? ""), [session.project]);

  const run = (what: string, fn: () => Promise<{ text: string; ok: boolean }>) => {
    setBusy(what);
    setNote(null);
    fn()
      .then(async (r) => {
        setBusy("Refreshing…");
        await load();
        setNote(r);
      })
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
      setConflictWith(r.resolveWith ?? null);
      return { ok: r.merged, text: r.merged ? r.message.replace(/^Merge made by the '[^']+' strategy\.?$/, `brought ${status?.base ?? "the base"} into this branch`) : r.message };
    });
  // after Merge into main: open the base, then delete the branch just merged (the open branch is never deleted)
  const openBaseAndDelete = (base: string, merged: string) =>
    run("Opening…", async () => {
      setMergeOpen(false);
      onBusy(`Opening ${base} — cloning it on the server the first time…`);
      try {
        await api.openWorkspace(base, project || undefined);
      } catch (e) {
        onBusy(null);
        throw e;
      }
      const r = await api.git.deleteBranches([merged]);
      onWorkspaceChanged();
      const one = r.results[0];
      return { ok: !!one?.deleted, text: one?.deleted ? `opened ${base}; deleted ${merged}${one.note ? ` (${one.note})` : ""}` : `opened ${base}; ${merged} kept: ${one?.note ?? "not deleted"}` };
    });
  const openBase = (base: string) =>
    run("Opening…", async () => {
      setMergeOpen(false);
      onBusy(`Opening ${base} — cloning it on the server the first time…`);
      try {
        await api.openWorkspace(base, project || undefined);
      } catch (e) {
        onBusy(null);
        throw e;
      }
      onWorkspaceChanged();
      return { ok: true, text: `opened ${project ? project + " / " : ""}${base}` };
    });
  const openBranch = () =>
    run("Opening…", async () => {
      // the server clones the branch into a workspace of yours (the first time) — the page says so meanwhile
      onBusy(`Opening ${branch.trim() || "the checkout"} — cloning it on the server…`);
      try {
        await api.openWorkspace(branch.trim(), project || undefined);
      } catch (e) {
        onBusy(null);
        throw e;
      }
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
          <button className="link" onClick={() => (!open && load(), setOpen(!open))} data-testid="repo-switch">
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
                {(info?.yours ?? []).length > 0 && (
                  <optgroup label="Your branches">
                    {(info?.yours ?? []).map((y) => (
                      <option key={"y" + y.branch} value={y.branch}>
                        {y.branch}
                        {y.branch === session.branch ? " (open)" : ""}
                        {!y.pushed ? " (not pushed)" : y.ahead > 0 ? ` (${y.ahead} commit${y.ahead === 1 ? "" : "s"} not pushed)` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="On the repository">
                  {(info?.branches ?? [])
                    .filter((b) => !(info?.yours ?? []).some((y) => y.branch === b))
                    .map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                </optgroup>
                <option value={NEW}>new branch…</option>
              </select>
              {pick === NEW && <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={`name (starts from ${info?.base ?? "main"})`} spellCheck={false} autoFocus data-testid="repo-branch" />}
              <button onClick={openBranch} disabled={(!branch.trim() && !info?.inPlace) || busy !== null} data-testid="repo-open">
                Open
              </button>
              {status?.branchCleanup && (
                <button className="link small" onClick={() => setCleanup(true)} title="Delete branches whose every commit is already in the base branch" data-testid="repo-merged-branches">
                  merged branches…
                </button>
              )}
            </span>
          )}
        </span>
      )}
      {status?.repository && (
        <>
          <span className="muted small" title={status.last ? `${status.last.hash} ${status.last.author}, ${status.last.when}: ${status.last.subject}` : ""}>
            {!hosted && <>on <strong>{status.branch}</strong> · </>}
            {busy ? (
              <span className="busy-line" data-testid="repo-busy">
                <span className="spinner" /> {busy}
              </span>
            ) : (
              <button className={changed === 0 ? "link" : "pill warn dirty"} onClick={() => onSelect({ type: "changes", against: "head" })} title="What differs from the last commit, file by file" data-testid="repo-changes">
                {changed === 0 ? "nothing to commit" : `● ${changed} uncommitted file${changed === 1 ? "" : "s"}`}
              </button>
            )}
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
            <button onClick={update} disabled={busy !== null} title={`Bring what ${status.base} holds now into this branch (git merge origin/${status.base})`}>
              Update from {status.base}
            </button>
          )}
          {status.base && status.base === status.branch && status.upstream && (
            <button onClick={update} disabled={busy !== null} title={`What others merged into ${status.base} since this copy was taken (git pull)`} data-testid="repo-get-latest">
              Get latest {status.base}
            </button>
          )}
          {status.mergeHere && (session.user.editor || session.user.deployer) && status.base && status.base !== status.branch && (
            <button onClick={() => setMergeOpen(true)} disabled={busy !== null || changed > 0} title={changed > 0 ? "Commit first: a merge carries commits" : `Merge this branch into ${status.base} on the repository`} data-testid="repo-merge">
              Merge into {status.base}…
            </button>
          )}
          {pr?.request ? (
            <a href={pr.request.url} target="_blank" rel="noreferrer" className="link" title={pr.request.title} data-testid="repo-pr-link">
              {pr.provider === "GitLab" ? "!" : "#"}
              {pr.request.number} {pr.request.draft ? "draft" : pr.request.state} ↗
            </a>
          ) : pr?.available ? (
            <button onClick={() => setPrOpen(true)} disabled={!pr.pushed || busy !== null} title={pr.pushed ? `Create a ${pr.provider === "GitLab" ? "merge" : "pull"} request on ${pr.provider}${pr.error ? ` (could not check for an open one: ${pr.error})` : ""}` : "Push first: the request shows what the remote branch holds"} data-testid="repo-pr-create">
              Create {pr.provider === "GitLab" ? "merge" : "pull"} request…
            </button>
          ) : (
            status.compareUrl && (
              <a href={status.compareUrl} target="_blank" rel="noreferrer" className="link" title={pr?.reason ?? undefined} data-testid="repo-pr-compare">
                Pull request ↗
              </a>
            )
          )}
        </>
      )}
      {cleanup && <MergedBranchesDialog onClose={() => setCleanup(false)} onDeleted={load} />}
      {mergeOpen && (
        <MergeDialog
          userName={session.user.name}
          onClose={() => setMergeOpen(false)}
          onMerged={(r) => (setNote({ ok: true, text: r.message }), load())}
          onOpenBase={openBase}
          onOpenBaseAndDelete={status?.branchCleanup && session.branch ? (base) => openBaseAndDelete(base, session.branch!) : undefined}
        />
      )}
      {prOpen && pr && (
        <PullRequestDialog
          info={pr}
          onClose={() => setPrOpen(false)}
          onCreated={(r) => {
            setPrOpen(false);
            setPr({ ...pr, request: r });
            setNote({ ok: true, text: `created ${pr.provider === "GitLab" ? "!" : "#"}${r.number}` });
          }}
        />
      )}
      {busy && !status?.repository && <span className="muted small">{busy}</span>}
      {note && <span className={note.ok ? "ok-text small" : "err-text small"}>{note.text}</span>}
      {conflictWith && !note?.ok && (
        <button onClick={() => setResolving(true)} data-testid="repo-resolve">
          Resolve the conflicts…
        </button>
      )}
      {resolving && conflictWith && (
        <ConflictDialog
          with={conflictWith}
          theirsLabel={status?.base ?? "the base branch"}
          onClose={() => setResolving(false)}
          onDone={(m) => (setResolving(false), setConflictWith(null), setNote({ ok: true, text: m }), load())}
        />
      )}
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
