import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { api } from "../api";
import { monacoTheme } from "../monaco";
import { usePending } from "../pending";
import { summarize } from "../rules";
import type { Artifact } from "../types";
import { PendingBar } from "./PendingBar";
import { ReviewDialog } from "./ReviewDialog";
import { SchemaMapEditor } from "./SchemaMapEditor";
import { TableEditor } from "./TableEditor";

interface Props {
  path: string;
  revision: string;
  onOpen: (path: string) => void;
  onSaved: () => void;
}

type Tab = "structured" | "source" | "refs";

const STRUCTURED: Record<string, string> = { "dirxml-script": "Rules", "schema-map": "Map", "mapping-table": "Table" };

/**
 * One policy or resource, two ways. The structured tab fits the kind: a DirXML Script policy's
 * rules (read-only for now), a schema map's name pairs, a mapping table's grid — the last two
 * editable through their typed operations. Source is the document itself: edit it, review the
 * change as a diff with the core's verdict, apply it through `artifact.set-content`.
 */
export function ArtifactView({ path, revision, onOpen, onSaved }: Props) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("structured");
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [changedOnDisk, setChangedOnDisk] = useState(false);
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

  const summary = useMemo(() => (artifact && artifact.kind === "dirxml-script" ? summarize(draft ?? artifact.content) : null), [artifact, draft]);

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
      {tab === "structured" && summary && (
        <div className="rules">
          {summary.error && <div className="banner error">The source is not well-formed: {summary.error}</div>}
          {summary.rules.length === 0 && !summary.error && <p className="muted pad">This policy has no rules.</p>}
          {summary.rules.map((r) => (
            <section key={r.index} className={r.disabled ? "rule disabled" : "rule"}>
              <header>
                <span className="num">{r.index}</span>
                <h3>{r.description}</h3>
                {r.disabled && <span className="pill warn">disabled</span>}
              </header>
              <div className="cols">
                <div>
                  <h4>When {r.conditions.length > 0 ? `(${r.logic})` : ""}</h4>
                  {r.conditions.length === 0 ? (
                    <p className="muted">always</p>
                  ) : (
                    <ul>
                      {r.conditions.map((c, i) => (
                        <li key={i}>
                          <code>{c}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h4>Do</h4>
                  {r.actions.length === 0 ? (
                    <p className="muted">nothing</p>
                  ) : (
                    <ol>
                      {r.actions.map((a, i) => (
                        <li key={i}>
                          <code>{a}</code>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </section>
          ))}
          <p className="muted small pad">The rule view is read-only for now. Edit in Source; the list follows what you type.</p>
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
