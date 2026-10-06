import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { api } from "../api";
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
                </p>
                <div className="stagediff">
                  <DiffEditor language={file.language ?? "plaintext"} original={file.before ?? ""} modified={file.after ?? ""} theme={monacoTheme()} options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false }} />
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
