import { useEffect, useMemo, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { GIT_CHANGED, api } from "../api";
import { monacoTheme } from "../monaco";
import type { ConflictFile, Conflicts } from "../types";

/** One conflict git marked in a file: where it is in the text, and its two sides. */
interface Block {
  start: number;
  end: number;
  ours: string;
  theirs: string;
}

const BLOCK = /^<<<<<<< [^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> [^\n]*(\n|$)/gm;

function blocks(text: string): Block[] {
  const out: Block[] = [];
  BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, ours: m[1] ?? "", theirs: m[2] ?? "" });
  }
  return out;
}

const MARKS = /^(<<<<<<<|>>>>>>>)( |$)|^=======$/m;

/**
 * Conflicts settled on the page: a merge (Update from the base branch, or a captured state) that conflicts. Per file,
 * the incoming version on the left and the merge's result on the right, git's conflict marks where the two clash.
 * Each conflict: keep this branch's lines, take the incoming ones, or both; the arrow beside a block takes the
 * incoming lines; the right side can be edited. A file deleted on one side is kept or deleted whole. Commit the merge
 * when no marks are left; the server does the merge again and writes exactly this, or refuses (a side moved, the tree
 * wouldn't read) with nothing changed.
 */
export function ConflictDialog({ with: withRef, theirsLabel, onClose, onDone }: { with: string; theirsLabel: string; onClose: () => void; onDone: (message: string) => void }) {
  const [data, setData] = useState<Conflicts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>("Reading the conflicts…");
  const [selected, setSelected] = useState(0);
  // per file: the text to commit, or null to delete the file
  const [texts, setTexts] = useState<Record<string, string | null>>({});
  const [decided, setDecided] = useState<Record<string, boolean>>({});
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api.git
      .conflicts(withRef)
      .then((c) => {
        setData(c);
        const t: Record<string, string | null> = {};
        for (const f of c.files) {
          t[f.file] = f.merged ?? f.ours ?? f.theirs ?? "";
        }
        setTexts(t);
        setMessage(`Merge ${theirsLabel} into ${c.branch}`);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  }, [withRef, theirsLabel]);

  const files = data?.files ?? [];
  const file: ConflictFile | undefined = files[selected];
  const whole = (f: ConflictFile) => f.ours === null || f.theirs === null;   // deleted on one side: kept or deleted whole
  const resolved = (f: ConflictFile) => (whole(f) ? !!decided[f.file] : texts[f.file] !== undefined && texts[f.file] !== null && !MARKS.test(texts[f.file] ?? ""));
  const left = files.filter((f) => !resolved(f)).length;
  const here = file ? texts[file.file] ?? "" : "";
  const marks = useMemo(() => blocks(here ?? ""), [here]);

  const set = (f: string, text: string | null, remount = true) => {
    setTexts((cur) => ({ ...cur, [f]: text }));
    if (remount) {
      setVersion((v) => v + 1);
    }
  };
  const settle = (b: Block, how: "ours" | "theirs" | "both") => {
    if (!file) {
      return;
    }
    const keep = how === "ours" ? b.ours : how === "theirs" ? b.theirs : b.ours + b.theirs;
    set(file.file, here.slice(0, b.start) + keep + here.slice(b.end));
  };
  const commit = async () => {
    if (!data) {
      return;
    }
    setBusy("Committing the merge…");
    setError(null);
    try {
      const r = await api.git.resolve(withRef, data.head, data.theirs, texts, message);
      window.dispatchEvent(new Event(GIT_CHANGED));
      onDone(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal" data-testid="conflict-dialog">
        <div className="modal-head">
          <h3>
            Resolve the conflicts with {theirsLabel}
            {data ? ` in ${data.branch}` : ""}
          </h3>
          <span className="muted small">Nothing is written until you commit the merge.</span>
        </div>
        <div className="modal-body">
          <div className="modal-side">
            <h4>Conflicting files</h4>
            {files.length === 0 ? (
              <p className="muted small">{busy ?? data?.message ?? "none"}</p>
            ) : (
              <ul className="filelist">
                {files.map((f, i) => (
                  <li key={f.file}>
                    <button className={i === selected ? "leaf active" : "leaf"} onClick={() => setSelected(i)} title={`${f.file}: ${f.kind}`}>
                      <span className={resolved(f) ? "badge st-added" : "badge st-deleted"}>{resolved(f) ? "✓" : "!"}</span>
                      {f.file.split("/").slice(-2).join("/")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(data?.mergedCleanly ?? []).length > 0 && <p className="muted small">{data!.mergedCleanly.length} other file(s) merge without conflict and come along.</p>}
          </div>
          <div className="modal-diff">
            {file && whole(file) && (
              <div className="pad" data-testid="conflict-whole">
                <p>
                  <strong>{file.file}</strong>: {file.kind}.
                </p>
                <div className="addrow">
                  <button className={decided[file.file] && texts[file.file] !== null ? "primary" : ""} onClick={() => (set(file.file, file.ours ?? file.theirs ?? ""), setDecided({ ...decided, [file.file]: true }))}>
                    Keep the file{file.ours === null ? ` (${theirsLabel}'s version)` : " (this branch's version)"}
                  </button>
                  <button className={decided[file.file] && texts[file.file] === null ? "primary" : ""} onClick={() => (set(file.file, null), setDecided({ ...decided, [file.file]: true }))}>
                    Delete it
                  </button>
                </div>
              </div>
            )}
            {file && !whole(file) && (
              <>
                <div className="mergebar small" data-testid="conflict-blocks">
                  <span className="muted">
                    Left: {theirsLabel}'s version. Right: the merge, as it will be committed; git marked each clash between <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> and{" "}
                    <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code>. The arrow beside a block takes {theirsLabel}'s lines; you can also edit.
                  </span>
                  {marks.length === 0 ? (
                    <p className="ok-text">No conflict marks left in this file.</p>
                  ) : (
                    <ol className="conflicts">
                      {marks.map((b, i) => (
                        <li key={b.start}>
                          Conflict {i + 1}: <button onClick={() => settle(b, "ours")} data-testid={"conflict-ours-" + i}>Keep this branch's</button>{" "}
                          <button onClick={() => settle(b, "theirs")} data-testid={"conflict-theirs-" + i}>
                            Take {theirsLabel}'s
                          </button>{" "}
                          <button onClick={() => settle(b, "both")}>Keep both</button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <DiffEditor
                  key={file.file + ":" + version}
                  height="calc(100% - 110px)"
                  language={file.language ?? "plaintext"}
                  original={file.theirs ?? ""}
                  modified={here ?? ""}
                  theme={monacoTheme()}
                  options={{ readOnly: false, originalEditable: false, renderMarginRevertIcon: true, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: false, wordWrap: "on", diffWordWrap: "on", minimap: { enabled: false }, scrollBeyondLastLine: false }}
                  onMount={(editor) => {
                    const f = file.file;
                    const modified = editor.getModifiedEditor();
                    modified.onDidChangeModelContent(() => set(f, modified.getValue(), false));
                  }}
                />
              </>
            )}
            {!file && !busy && data && <p className="muted pad">{data.message}</p>}
          </div>
        </div>
        <div className="modal-result">
          {error && <p className="err-text">{error}</p>}
          {data && files.length > 0 && <p className="small">{left === 0 ? "Every conflict is settled." : `${left} of ${files.length} file(s) still to settle.`}</p>}
        </div>
        <div className="modal-foot">
          <input className="commitmsg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="merge message" data-testid="conflict-message" />
          <button onClick={onClose} disabled={busy !== null}>
            Cancel
          </button>
          <button className="primary" onClick={() => void commit()} disabled={busy !== null || !data || files.length === 0 || left > 0} data-testid="conflict-commit">
            {busy === "Committing the merge…" ? busy : "Commit the merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
