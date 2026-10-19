import { useEffect, useState } from "react";
import { api } from "../api";
import type { MergedBranches } from "../types";

/**
 * Branches whose every commit is in the base: merged, so deleting one loses nothing. Each with when and by whom it last
 * changed and whether you have a copy of it here; tick and delete. The server checks again that each is merged, removes
 * your own copy unless it holds uncommitted or unpushed work, and never deletes the branch you have open.
 */
export function MergedBranchesDialog({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const [data, setData] = useState<MergedBranches | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>("Reading the branches…");
  const [results, setResults] = useState<{ branch: string; deleted: boolean; note?: string | null }[] | null>(null);
  const load = () => {
    setBusy("Reading the branches…");
    api.git
      .mergedBranches()
      .then((d) => (setData(d), setPick(new Set(d.branches.filter((b) => b.branch !== d.open).map((b) => b.branch)))))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  useEffect(load, []);
  const remove = async () => {
    setBusy(`Deleting ${pick.size} branch(es)…`);
    setError(null);
    try {
      const r = await api.git.deleteBranches([...pick]);
      setResults(r.results);
      onDeleted();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };
  const branches = data?.branches ?? [];
  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal prdialog" data-testid="merged-branches">
        <div className="modal-head">
          <h3>Branches merged into {data?.base ?? "the base branch"}</h3>
          <span className="muted small">Every commit of these is in {data?.base ?? "the base branch"}: deleting one loses nothing.</span>
        </div>
        <div className="modal-body pad">
          {busy && <p className="muted">{busy}</p>}
          {!busy && branches.length === 0 && <p>No merged branches left to delete.</p>}
          {branches.length > 0 && (
            <ul className="plain mergelist" data-testid="merged-branches-list">
              {branches.map((b) => (
                <li key={b.branch}>
                  <label className="checkchip">
                    <input
                      type="checkbox"
                      checked={pick.has(b.branch)}
                      disabled={b.branch === data?.open}
                      onChange={(e) => {
                        const next = new Set(pick);
                        if (e.target.checked) {
                          next.add(b.branch);
                        } else {
                          next.delete(b.branch);
                        }
                        setPick(next);
                      }}
                    />{" "}
                    <code>{b.branch}</code>
                  </label>{" "}
                  <span className="muted small">
                    last changed {b.when} by {b.author}
                    {b.yourCopy ? " · your copy here goes too" : ""}
                    {b.branch === data?.open ? " · open now: switch first" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {results && (
            <ul className="plain small" data-testid="merged-branches-results">
              {results.map((r) => (
                <li key={r.branch} className={r.deleted ? "ok-text" : "err-text"}>
                  {r.deleted ? `deleted ${r.branch}` : `kept ${r.branch}`}
                  {r.note ? `: ${r.note}` : ""}
                </li>
              ))}
            </ul>
          )}
          {error && <p className="err-text">{error}</p>}
          <p className="muted small">Others who had one of these open keep their copy; it shows as not on the repository.</p>
        </div>
        <div className="modal-foot">
          <button onClick={onClose} disabled={busy !== null && !data}>
            Close
          </button>
          <button className="danger" onClick={() => void remove()} disabled={busy !== null || pick.size === 0} data-testid="merged-branches-delete">
            Delete {pick.size} branch{pick.size === 1 ? "" : "es"}
          </button>
        </div>
      </div>
    </div>
  );
}
