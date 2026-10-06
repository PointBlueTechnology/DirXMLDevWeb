import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { api } from "../api";
import { monacoTheme } from "../monaco";
import type { OpCall, TreeFile } from "../types";
import { ReviewDialog } from "./ReviewDialog";

interface Props {
  file: string;
  revision: string;
  /** The operation that saves this file's whole content, when the core has one for it. */
  saveOp: ((content: string) => OpCall) | null;
  onSaved: () => void;
}

/**
 * A file of the tree: a configuration document, an entitlement, a form, a PRD part. Where the
 * core has an operation that replaces the whole document, the file is editable and saves through
 * it; otherwise it is read-only here and changed through Operations.
 */
export function FileView({ file, revision, saveOp, onSaved }: Props) {
  const [data, setData] = useState<TreeFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const dirty = draft !== null && data !== null && draft !== data.content;

  useEffect(() => {
    if (dirty) {
      return;
    }
    let gone = false;
    api
      .file(file)
      .then((d) => !gone && (setData(d), setError(null), setDraft(null)))
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, revision]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data) {
    return <p className="muted pad">Loading…</p>;
  }
  const editing = draft !== null;
  return (
    <div className="view">
      <div className="viewhead">
        <div>
          <div className="kicker">File{saveOp ? "" : " · read-only here"}</div>
          <h2>{file.split("/").pop()}</h2>
          <div className="muted small">{file}</div>
        </div>
        <div className="actions">
          {saveOp && !editing && <button onClick={() => setDraft(data.content)}>Edit source</button>}
          {saveOp && editing && (
            <>
              <button onClick={() => setDraft(null)}>Discard</button>
              <button className="primary" disabled={!dirty} onClick={() => setReviewing(true)}>
                Review changes
              </button>
            </>
          )}
          {!saveOp && <span className="muted small right">Change it through Operations.</span>}
        </div>
      </div>
      <div className="editor">
        <Editor
          language={data.language}
          value={draft ?? data.content}
          theme={monacoTheme()}
          onChange={(v) => editing && setDraft(v ?? "")}
          options={{ readOnly: !editing, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2 }}
        />
      </div>
      {reviewing && saveOp && draft !== null && (
        <ReviewDialog
          title={`Review changes to ${file.split("/").pop()}`}
          ops={[saveOp(draft)]}
          onClose={() => setReviewing(false)}
          onApplied={() => {
            setReviewing(false);
            setDraft(null);
            onSaved();
          }}
        />
      )}
    </div>
  );
}
