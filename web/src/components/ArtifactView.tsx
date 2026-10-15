import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { api } from "../api";
import { monacoTheme } from "../monaco";
import { usePending } from "../pending";
import { PolicyEditor } from "../policy/PolicyEditor";
import type { Artifact, OpResult } from "../types";
import { PendingBar } from "./PendingBar";
import { ReviewDialog } from "./ReviewDialog";
import { SchemaMapEditor } from "./SchemaMapEditor";
import { TableEditor } from "./TableEditor";

interface Props {
  path: string;
  revision: string;
  onOpen: (path: string) => void;
  onSaved: () => void;
  /** The artifact was deleted: leave its view. */
  onGone?: () => void;
  /** The artifact was renamed: show it at its new path. */
  onMoved?: (path: string) => void;
}

type Tab = "structured" | "source" | "refs";

const STRUCTURED: Record<string, string> = { "dirxml-script": "Rules", "schema-map": "Map", "mapping-table": "Table" };

/**
 * One policy or resource, two ways. The structured tab fits the kind: a DirXML Script policy's
 * rules, conditions, actions and tokens; a schema map's name pairs; a mapping table's grid.
 * Source is the document itself. For a policy the two tabs edit one draft, checked by the
 * engine's compiler as you go, reviewed as a diff, and saved through `artifact.set-content`.
 */
export function ArtifactView({ path, revision, onOpen, onSaved, onGone, onMoved }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [renameReview, setRenameReview] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("structured");
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [changedOnDisk, setChangedOnDisk] = useState(false);
  const [check, setCheck] = useState<{ state: "idle" | "checking" | "done"; result?: OpResult; error?: string }>({ state: "idle" });
  const [showCheck, setShowCheck] = useState(false);
  const checkSeq = useRef(0);
  const pending = usePending();

  const dirty = draft !== null && artifact !== null && draft !== artifact.content;

  useEffect(() => {
    let gone = false;
    if (dirty) {
      // keep the user's edit; say that the tree moved under it
      if (artifact && revision && artifact.revision !== revision) {
        setChangedOnDisk(true);
      }
      return;
    }
    api
      .artifact(path)
      .then((a) => {
        if (gone) {
          return;
        }
        setArtifact(a);
        setError(null);
        setChangedOnDisk(false);
        setDraft(null);
        setTab((t) => (t === "structured" && !STRUCTURED[a.kind] ? "source" : t));
      })
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, revision]);

  // the live check: a pause in editing sends the draft through the same preview a review runs,
  // so the engine's compiler and every other check answer while the change is still on screen
  useEffect(() => {
    if (!dirty || !artifact || draft === null) {
      setCheck({ state: "idle" });
      return;
    }
    const seq = ++checkSeq.current;
    setCheck((c) => ({ ...c, state: "checking" }));
    const timer = setTimeout(async () => {
      try {
        const revision = (await api.session()).revision ?? "";
        const result = await api.batch([{ name: "artifact.set-content", args: { path: artifact.path }, files: { "content-file": draft }, label: "check" }], true, revision);
        if (seq === checkSeq.current) {
          setCheck({ state: "done", result });
        }
      } catch (e) {
        if (seq === checkSeq.current) {
          setCheck({ state: "done", error: e instanceof Error ? e.message : String(e) });
        }
      }
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!artifact) {
    return <p className="muted pad">Loading…</p>;
  }

  const reload = async () => {
    const a = await api.artifact(path);
    setArtifact(a);
    setDraft(null);
    setEditing(false);
    setChangedOnDisk(false);
  };

  const structuredLabel = STRUCTURED[artifact.kind];

  return (
    <div className="view">
      <div className="viewhead">
        <div>
          <div className="kicker">
            {artifact.kind} · {artifact.scope}
            {artifact.driver ? ` · ${artifact.driver}` : ""}
            {artifact.packaged ? " · packaged" : ""}
          </div>
          <h2>{artifact.name}</h2>
          <div className="muted small">{artifact.file ?? artifact.path}</div>
        </div>
        <div className="actions">
          {!editing && pending.ops.length === 0 && (
            <>
              <button onClick={() => (setNewName(artifact.name), setRenaming(true))} title="Rename it, and rewrite every reference to it (links, includes, Map tokens)" data-testid="artifact-rename">
                Rename…
              </button>
              <button className="danger" onClick={() => setDeleting(true)} title="Delete it; refused while anything refers to it" data-testid="artifact-delete">
                Delete…
              </button>
            </>
          )}
          {!editing && artifact.editable && (
            <button
              disabled={pending.ops.length > 0}
              title={pending.ops.length > 0 ? "Apply or discard the pending changes first" : "Edit the document itself"}
              onClick={() => {
                setEditing(true);
                setTab("source");
                setDraft(artifact.content);
              }}
            >
              Edit source
            </button>
          )}
          {editing && dirty && (
            <button
              className={"checkchip" + (check.state === "done" ? (check.result?.ok ? " good" : " bad") : "")}
              title="The draft, run through the engine's compiler and the rest of validation"
              onClick={() => setShowCheck((v) => !v)}
            >
              {check.state === "checking" ? "checking…" : check.state === "done" ? (check.error ? "check failed" : check.result?.ok ? "✓ valid" : `✗ ${check.result?.newErrors.length || 1} problem${(check.result?.newErrors.length ?? 1) === 1 ? "" : "s"}`) : "…"}
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={() => {
                  setDraft(null);
                  setEditing(false);
                  if (changedOnDisk) {
                    void reload();
                  }
                }}
              >
                Discard
              </button>
              <button className="primary" disabled={!dirty} onClick={() => setReviewing(true)}>
                Review changes
              </button>
            </>
          )}
        </div>
      </div>
      {editing && dirty && check.state === "done" && (showCheck || !(check.result?.ok ?? false)) && (check.error || (check.result && !check.result.ok)) && (
        <ul className="findings checklist">
          {check.error && (
            <li className="finding error">
              <div>
                <span className="msg">{check.error}</span>
              </div>
            </li>
          )}
          {check.result && !check.result.ok && check.result.newErrors.length === 0 && (
            <li className="finding error">
              <div>
                <span className="msg">{check.result.refusal}</span>
              </div>
            </li>
          )}
          {check.result?.newErrors.map((e, i) => (
            <li key={i} className="finding error">
              <div>
                <span className="code">{e.code}</span>
                <span className="msg">{e.message}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {changedOnDisk && <div className="banner warn">The tree changed on disk while you were editing. Your edit is kept; applying it will be refused until you reload.</div>}
      {artifact.packaged && (editing || pending.ops.length > 0) && <div className="banner warn">This artifact came from a package. Saving marks it customized, as Designer does.</div>}
      <PendingBar
        pending={pending}
        title={`Review changes to ${artifact.name}`}
        onSaved={() => {
          void reload();
          onSaved();
        }}
      />
      <div className="tabs">
        {structuredLabel && (
          <button className={tab === "structured" ? "tab active" : "tab"} onClick={() => setTab("structured")}>
            {structuredLabel}
          </button>
        )}
        <button className={tab === "source" ? "tab active" : "tab"} onClick={() => setTab("source")}>
          Source{dirty ? " •" : ""}
        </button>
        <button className={tab === "refs" ? "tab active" : "tab"} onClick={() => setTab("refs")}>
          References <span className="count">{artifact.refs.length}</span>
        </button>
      </div>
      {tab === "structured" && artifact.kind === "schema-map" && (
        <div className="scroll">
          {artifact.driver ? <SchemaMapEditor driver={artifact.driver} content={artifact.content} pending={pending} /> : <p className="muted pad">A schema map outside a driver is edited in the source.</p>}
        </div>
      )}
      {tab === "structured" && artifact.kind === "mapping-table" && (
        <div className="scroll">
          <TableEditor path={artifact.path} content={artifact.content} pending={pending} />
        </div>
      )}
      {tab === "structured" && artifact.kind === "dirxml-script" && (
        <div className="scroll">
          <PolicyEditor
            xml={draft ?? artifact.content}
            onChange={(xml) => {
              setDraft(xml);
              setEditing(true);
            }}
          />
        </div>
      )}
      {tab === "source" && (
        <div className="editor">
          <Editor
            language={artifact.language}
            value={draft ?? artifact.content}
            theme={monacoTheme()}
            onChange={(v) => editing && setDraft(v ?? "")}
            options={{ readOnly: !editing, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2 }}
          />
        </div>
      )}
      {tab === "refs" && (
        <div className="refs pad">
          {artifact.refs.length === 0 ? (
            <p className="muted">Nothing in the tree refers to this artifact.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>How</th>
                  <th>From</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {artifact.refs.map((r, i) => (
                  <tr key={i}>
                    <td>{r.kind}</td>
                    <td>
                      <button className="link" onClick={() => onOpen(r.from)}>
                        {r.from}
                      </button>
                    </td>
                    <td>{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {renaming && !renameReview && (
        <div className="modal-back" role="dialog" aria-modal="true">
          <div className="modal" data-testid="rename-dialog">
            <div className="modal-head">
              <h3>Rename {artifact.name}</h3>
              <span className="muted small">Every reference is rewritten with it: policy-set links, includes, Map tokens ({artifact.refs.length} now).</span>
            </div>
            <div className="modal-body pad">
              <label className="field wide">
                <em>New name</em>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} spellCheck={false} autoFocus data-testid="rename-name" />
              </label>
            </div>
            <div className="modal-foot">
              <button onClick={() => setRenaming(false)}>Cancel</button>
              <button className="primary" disabled={!newName.trim() || newName.trim() === artifact.name} onClick={() => setRenameReview(true)} data-testid="rename-review">
                Review
              </button>
            </div>
          </div>
        </div>
      )}
      {renaming && renameReview && (
        <ReviewDialog
          title={`Rename ${artifact.name} to ${newName.trim()}`}
          ops={[{ name: "artifact.rename", args: { path: artifact.path, name: newName.trim() }, label: `rename ${artifact.name} to ${newName.trim()}` }]}
          onClose={() => (setRenameReview(false), setRenaming(false))}
          onApplied={() => {
            setRenameReview(false);
            setRenaming(false);
            const moved = artifact.path.replace(/[^/]+$/, newName.trim());
            onMoved ? onMoved(moved) : (onSaved(), onOpen(moved));
          }}
        />
      )}
      {deleting && (
        <ReviewDialog
          title={`Delete ${artifact.name}`}
          ops={[{ name: "artifact.delete", args: { path: artifact.path, unlink: "true" }, label: `delete ${artifact.name}${artifact.refs.some((r) => r.kind === "link") ? " and its policy-set links" : ""}` }]}
          onClose={() => setDeleting(false)}
          onApplied={() => {
            setDeleting(false);
            onGone ? onGone() : onSaved();
          }}
        />
      )}
      {reviewing && draft !== null && (
        <ReviewDialog
          title={`Review changes to ${artifact.name}`}
          ops={[{ name: "artifact.set-content", args: { path: artifact.path }, files: { "content-file": draft }, label: `replace the content of ${artifact.name}` }]}
          onClose={() => setReviewing(false)}
          onApplied={() => {
            setReviewing(false);
            void reload();
            onSaved();
          }}
        />
      )}
    </div>
  );
}
