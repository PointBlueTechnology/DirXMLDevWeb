import { useEffect, useState } from "react";
import { api } from "../api";
import type { MergePreview, MergeResult } from "../types";

/**
 * Merge into the base branch (docs/git-workflow.md), for a repository with no GitHub or GitLab in front of it: what
 * the branch carries, a warning when the base has moved on (the merge would hold content no environment tested),
 * then the merge — on the repository, pushed, this checkout left on its branch. A conflict merges nothing and lists
 * the files; the way on is Update from the base on the branch.
 */
export function MergeDialog({ userName, onClose, onMerged, onOpenBase, onOpenBaseAndDelete }: { userName: string; onClose: () => void; onMerged: (r: MergeResult) => void; onOpenBase: (base: string) => void; onOpenBaseAndDelete?: (base: string) => void }) {
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  useEffect(() => {
    api.git
      .mergePreview()
      .then(setPreview)
      .catch((e: Error) => setError(e.message));
  }, []);
  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.git.mergeIntoBase();
      setResult(r);
      if (r.merged) {
        onMerged(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const base = preview?.base ?? "the base branch";
  const nothing = preview !== null && preview.commits.length === 0;
  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal prdialog" data-testid="merge-dialog">
        <div className="modal-head">
          <h3>
            Merge {preview?.branch ?? "this branch"} into {base}
          </h3>
          <span className="muted small">On the project's repository, as {userName}. This checkout stays on its branch.</span>
        </div>
        <div className="modal-body pad">
          {!preview && !error && <p className="muted">Looking at what the branch carries…</p>}
          {preview && preview.uncommitted > 0 && (
            <p className="err-text" data-testid="merge-uncommitted">
              {preview.uncommitted} uncommitted file{preview.uncommitted === 1 ? "" : "s"}: commit first. A merge carries commits, not work in progress.
            </p>
          )}
          {nothing && <p>{base} already has everything on this branch: nothing to merge.</p>}
          {preview && preview.commits.length > 0 && (
            <>
              <div>
                <strong>
                  {preview.commits.length}
                  {preview.commits.length === 50 ? "+" : ""} commit{preview.commits.length === 1 ? "" : "s"}
                </strong>
                , {preview.files.length} file{preview.files.length === 1 ? "" : "s"} changed
                <ul className="mergelist" data-testid="merge-commits">
                  {preview.commits.map((c) => (
                    <li key={c.hash}>
                      <code>{c.hash}</code> {c.subject} <span className="muted">— {c.author}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <details>
                <summary className="small">The files</summary>
                <ul className="mergelist small">
                  {preview.files.slice(0, 200).map((f) => (
                    <li key={f.file}>
                      <code>{f.status}</code> {f.file}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
          {preview && preview.behind > 0 && preview.commits.length > 0 && (
            <p className="warn-text" data-testid="merge-behind">
              {base} has {preview.behind} commit{preview.behind === 1 ? "" : "s"} this branch lacks. The merge will hold the two together, which no environment has tested, and
              production will ask for a test deploy of {base} first. To test the combination before it reaches {base}: Cancel, Update from {base}, deploy to test, then merge.
            </p>
          )}
          {result && (
            <div className={result.merged ? "ok-text" : "err-text"} data-testid="merge-result">
              <p>{result.message}</p>
              {(result.conflicts ?? []).length > 0 && (
                <ul className="mergelist small">
                  {(result.conflicts ?? []).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && (
            <p className="err-text" data-testid="merge-error">
              {error}
            </p>
          )}
        </div>
        <div className="modal-foot">
          {result?.merged ? (
            <>
              <button onClick={onClose}>Close</button>
              {onOpenBaseAndDelete && (
                <button onClick={() => onOpenBaseAndDelete(preview?.base ?? "main")} title={`Its every commit is in ${base} now: deleting it loses nothing`} data-testid="merge-open-base-delete">
                  Open {base} and delete {preview?.branch ?? "this branch"}
                </button>
              )}
              <button className="primary" onClick={() => onOpenBase(preview?.base ?? "main")} data-testid="merge-open-base">
                Open {base}
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="primary" onClick={() => void merge()} disabled={busy || !preview || nothing || preview.uncommitted > 0} data-testid="merge-confirm">
                {busy ? "Merging…" : `Merge into ${base}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
