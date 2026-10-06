import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { ApiError, api } from "../api";
import { monacoTheme } from "../monaco";
import type { FileDiff, OpCall, OpResult } from "../types";

interface Props {
  title: string;
  ops: OpCall[];
  onClose: () => void;
  /** Called after the change is written. */
  onApplied: (result: OpResult) => void;
}

/**
 * The gate every write goes through. The changes are run against a throwaway copy of the tree,
 * and the reviewer sees what would happen: each file before and after, and the core's verdict
 * (new validation errors, a refusal, a packaged artifact being customized). Apply is offered
 * only when that came back clean and something would actually change.
 */
export function ReviewDialog({ title, ops, onClose, onApplied }: Props) {
  const [result, setResult] = useState<OpResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState(0);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const revision = (await api.session()).revision ?? "";
      const r = await api.batch(ops, dryRun, revision);
      if (!dryRun && r.ok) {
        onApplied(r);
        return;
      }
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? "The tree changed on disk while this was open. Close, let the page reload, and review again." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void run(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const diffs: FileDiff[] = result?.diffs ?? [];
  const diff = diffs[selected];
  const nothing = !!result && result.ok && result.changedFiles.length === 0 && result.deletedFiles.length === 0;
  const blocked = !result || !result.ok || nothing || !result.dryRun;

  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <span className="muted small">Nothing is written until you apply.</span>
        </div>
        <div className="modal-body">
          <div className="modal-side">
            <h4>
              {ops.length} change{ops.length === 1 ? "" : "s"}
            </h4>
            <ol className="oplist">
              {ops.map((o, i) => (
                <li key={i} title={o.name}>
                  {o.label}
                </li>
              ))}
            </ol>
            <h4>Files</h4>
            {diffs.length === 0 ? (
              <p className="muted small">{busy ? "…" : "none"}</p>
            ) : (
              <ul className="filelist">
                {diffs.map((d, i) => (
                  <li key={d.file}>
                    <button className={i === selected ? "leaf active" : "leaf"} onClick={() => setSelected(i)} title={d.file}>
                      <span className={"badge st-" + d.status}>{d.status === "changed" ? "M" : d.status === "added" ? "A" : "D"}</span>
                      {d.file.split("/").slice(-2).join("/")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="modal-diff">
            {diff && diff.before !== undefined && diff.after !== undefined ? (
              <DiffEditor key={diff.file} language={diff.language} original={diff.before} modified={diff.after} theme={monacoTheme()} options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false }} />
            ) : (
              <p className="muted pad">{busy ? "Running the change against a copy of the tree…" : diff ? "This file is not shown as text." : "No file would change."}</p>
            )}
          </div>
        </div>
        <div className="modal-result">
          {error && <p className="err-text">{error}</p>}
          {result && <OpOutcome result={result} />}
        </div>
        <div className="modal-foot">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={() => void run(false)} disabled={busy || blocked} title={nothing ? "The stored content would not change" : blocked ? "The review did not pass" : "Write the change to the tree"}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

export function OpOutcome({ result }: { result: OpResult }) {
  const files = result.changedFiles.length;
  const deleted = result.deletedFiles.length;
  return (
    <div className="outcome">
      <p className={result.ok ? "ok-text" : "err-text"}>
        {result.ok ? (result.dryRun ? "Review passed: " : result.written ? "Written: " : "Nothing to write: ") : "Refused: "}
        {result.ok ? `${files} file(s) change${deleted ? `, ${deleted} deleted` : ""}` : (result.refusal ?? "the change was not accepted")}
      </p>
      {result.ok && result.dryRun && files === 0 && deleted === 0 && (
        <p className="muted small">The core would store the same content: whitespace, and anything outside the root element such as a trailing comment, is normalised away.</p>
      )}
      {result.newErrors.length > 0 && (
        <ul className="findings">
          {result.newErrors.map((e, i) => (
            <li key={i} className="finding error">
              <div>
                <span className="code">{e.code}</span>
                <span className="path">{e.path}</span>
                <span className="msg">{e.message}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {result.customized.length > 0 && <p className="warn-text">Customizes packaged artifact(s): {result.customized.join(", ")}</p>}
      {result.notes.map((n, i) => (
        <p key={i} className="muted small">
          {n}
        </p>
      ))}
    </div>
  );
}
