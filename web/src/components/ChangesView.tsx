import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { GIT_CHANGED, api } from "../api";
import { monacoTheme } from "../monaco";
import type { GitDiff, GitStatus, Selection } from "../types";

type Against = "head" | "base" | "upstream";

/**
 * What differs, file by file, with both sides: the working tree against the last commit
 * (everything uncommitted), against the base branch on the remote (what a pull request would
 * carry), or against upstream (what has not been pushed). The vault is another comparison:
 * Vault → Compare.
 */
export function ChangesView({ initial, revision, onSelect }: { initial: Against; revision: string; onSelect: (s: Selection) => void }) {
  const [against, setAgainst] = useState<Against>(initial);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  // discarding one file's uncommitted change: asked once more inline, then done
  const [discarding, setDiscarding] = useState<string | null>(null);
  // block by block: the working file as edited here (some blocks put back as the last commit has them)
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [resets, setResets] = useState(0);
  const saveBlocks = (f: string, text: string) =>
    api.git
      .discardBlocks(f, text)
      .then((r) => (setNote({ ok: true, text: r.message }), setEdited(({ [f]: _gone, ...rest }) => rest), setResets((n) => n + 1), window.dispatchEvent(new Event(GIT_CHANGED))))
      .catch((e: Error) => setNote({ ok: false, text: e.message }));
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const discard = (f: string) =>
    api.git
      .discard(f)
      .then((r) => (setNote({ ok: true, text: r.message }), setDiscarding(null), window.dispatchEvent(new Event(GIT_CHANGED))))
      .catch((e: Error) => setNote({ ok: false, text: e.message }));

  useEffect(() => {
    api.git.status().then(setStatus).catch(() => setStatus(null));
  }, [revision]);
  useEffect(() => {
    let gone = false;
    setDiff(null);
    setError(null);
    api.git
      .diff(against)
      .then((d) => {
        if (!gone) {
          setDiff(d);
          setSelected(0);
        }
      })
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [against, revision]);

  const file = diff?.files[selected];
  const notText = (t?: string | null) => t === undefined || t === null || t === "(binary)" || t === "(too large to show)";
  // the working file's blocks can be put back one by one: since the last commit, a file still there, shown as text
  const blockwise = against === "head" && !!file && file.status !== "deleted" && file.status !== "" && !notText(file.before) && !notText(file.after);
  const changedHere = !!file && edited[file.file] !== undefined && edited[file.file] !== file.after;
  return (
    <div className="view changes">
      <div className="viewhead">
        <div>
          <div className="kicker">{status?.branch ? `branch ${status.branch}` : "changes"}</div>
          <h2>Changes</h2>
        </div>
        <span className="spacer" />
        <div className="tabs">
          <button className={against === "head" ? "tab active" : "tab"} onClick={() => setAgainst("head")} data-testid="changes-head">
            since the last commit
          </button>
          <button className={against === "base" ? "tab active" : "tab"} onClick={() => setAgainst("base")} disabled={!status?.base} title={status?.base ? `against origin/${status.base}: what a pull request would carry` : "no base branch known"}>
            vs {status?.base ?? "base"}
          </button>
          <button className={against === "upstream" ? "tab active" : "tab"} onClick={() => setAgainst("upstream")} disabled={!status?.upstream} title={status?.upstream ? `against ${status.upstream}: what is not pushed yet` : "nothing pushed yet"}>
            vs {status?.upstream ?? "upstream"}
          </button>
          <button className="tab" onClick={() => onSelect({ type: "vault" })} title="The tree against an Identity Vault">
            vs a vault ↗
          </button>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
      {note && <div className={note.ok ? "banner" : "banner error"}>{note.text}</div>}
      {diff && (
        <div className="changesbody">
          <ul className="filelist changelist" data-testid="changes-files">
            {diff.files.length === 0 && <li className="muted pad">Nothing differs ({against === "head" ? "the working tree is committed" : `the same as ${diff.ref}`}).</li>}
            {diff.files.map((f, i) => (
              <li key={f.file}>
                <button className={i === selected ? "leaf active" : "leaf"} onClick={() => setSelected(i)}>
                  <span className={"badge st-" + f.status}>{f.status === "added" ? "A" : f.status === "deleted" ? "D" : f.status === "renamed" ? "R" : "M"}</span>
                  {f.file}
                </button>
              </li>
            ))}
          </ul>
          <div className="changediff">
            {file && file.status !== "" && (
              <>
                <p className="muted small">
                  {file.file}
                  {file.from ? ` (was ${file.from})` : ""} — left: {diff.ref}; right: the working tree.{" "}
                  {file.file.endsWith(".xml") || file.file.endsWith(".json") ? (
                    <button className="link" onClick={() => onSelect({ type: "file", file: file.file })}>
                      open
                    </button>
                  ) : null}
                  {against === "head" &&
                    (discarding === file.file ? (
                      <span className="small" data-testid="changes-discard-confirm">
                        {" · "}
                        {file.status === "added" ? "Remove this new file?" : "Put this file back as the last commit has it?"}{" "}
                        <button className="danger" onClick={() =>
                            void discard(file.file).then(() => {
                              // a rename: its old name comes back too
                              if (file.from) {
                                void api.git.discard(file.from).catch(() => undefined);
                              }
                            })
                          } data-testid="changes-discard-go">
                          Discard
                        </button>{" "}
                        <button onClick={() => setDiscarding(null)}>Keep</button>
                      </span>
                    ) : (
                      <>
                        {" · "}
                        <button className="link" onClick={() => (setDiscarding(file.file), setNote(null))} title="Throw away this file's uncommitted change" data-testid="changes-discard">
                          discard…
                        </button>
                      </>
                    ))}
                </p>
                {blockwise && (
                  <div className="addrow tight small mergebar" data-testid="changes-blocks">
                    <span className="muted">
                      Left: the last commit. Right: your working file. The arrow beside a block (point at it) puts the last commit's lines back there; you can also edit the
                      right side. Nothing is written until you save.
                    </span>
                    <span className="spacer" />
                    {changedHere && (
                      <>
                        <button className="link" onClick={() => (setEdited(({ [file.file]: _gone, ...rest }) => rest), setResets(resets + 1))}>
                          start over
                        </button>
                        <button className="primary" onClick={() => void saveBlocks(file.file, edited[file.file] ?? "")} data-testid="changes-blocks-save">
                          Save
                        </button>
                      </>
                    )}
                  </div>
                )}
                <div className="stagediff">
                  <DiffEditor
                    key={file.file + ":" + resets + ":" + revision}
                    language={file.language ?? "plaintext"}
                    original={file.before ?? ""}
                    modified={blockwise ? (edited[file.file] ?? file.after ?? "") : (file.after ?? "")}
                    theme={monacoTheme()}
                    options={{ readOnly: !blockwise, originalEditable: false, renderMarginRevertIcon: blockwise, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: !blockwise, wordWrap: "on", diffWordWrap: "on", minimap: { enabled: false }, scrollBeyondLastLine: false }}
                    onMount={(editor) => {
                      if (!blockwise) {
                        return;
                      }
                      const f = file.file;
                      const modified = editor.getModifiedEditor();
                      modified.onDidChangeModelContent(() => {
                        const text = modified.getValue();
                        setEdited((cur) => ({ ...cur, [f]: text }));
                      });
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {!diff && !error && <p className="muted pad">Comparing…</p>}
    </div>
  );
}
