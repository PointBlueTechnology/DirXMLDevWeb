import { DiffEditor } from "@monaco-editor/react";
import { monacoTheme } from "../monaco";
import type { OpResult } from "../types";

interface Props {
  title: string;
  language: string;
  original: string;
  modified: string;
  result: OpResult | null;
  error: string | null;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}

/**
 * The gate every write goes through: the diff of what would change, and what the core's dry run
 * said about it (new validation errors, a refusal, a packaged artifact being customized). Apply
 * is offered only when the dry run came back clean.
 */
export function ReviewDialog({ title, language, original, modified, result, error, busy, onApply, onCancel }: Props) {
  const nothing = !!result && result.ok && result.changedFiles.length === 0 && result.deletedFiles.length === 0;
  const blocked = !result || !result.ok || nothing;
  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <span className="muted small">Nothing is written until you apply.</span>
        </div>
        <div className="modal-diff">
          <DiffEditor language={language} original={original} modified={modified} theme={monacoTheme()} options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false }} />
        </div>
        <div className="modal-result">
          {busy && <p className="muted">Asking the core…</p>}
          {error && <p className="err-text">{error}</p>}
          {result && <OpOutcome result={result} />}
        </div>
        <div className="modal-foot">
          <button onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={onApply} disabled={busy || blocked} title={nothing ? "The stored content would not change" : blocked ? "The dry run did not pass" : "Write the change to the tree"}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

export function OpOutcome({ result }: { result: OpResult }) {
  return (
    <div className="outcome">
      <p className={result.ok ? "ok-text" : "err-text"}>
        {result.ok ? (result.dryRun ? "Dry run passed: " : result.written ? "Written: " : "Nothing to write: ") : "Refused: "}
        {result.ok ? `${result.changedFiles.length} file(s) change${result.deletedFiles.length ? `, ${result.deletedFiles.length} deleted` : ""}` : (result.refusal ?? "the operation was not accepted")}
      </p>
      {result.ok && result.dryRun && result.changedFiles.length === 0 && result.deletedFiles.length === 0 && (
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
      {result.changedFiles.length > 0 && <p className="muted small">Files: {result.changedFiles.join(", ")}</p>}
      {result.deletedFiles.length > 0 && <p className="muted small">Deleted: {result.deletedFiles.join(", ")}</p>}
      {result.notes.map((n, i) => (
        <p key={i} className="muted small">
          {n}
        </p>
      ))}
    </div>
  );
}
