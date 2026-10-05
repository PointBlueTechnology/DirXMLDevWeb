import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { ApiError, api } from "../api";
import { monacoTheme } from "../monaco";
import { summarize } from "../rules";
import type { Artifact, OpResult } from "../types";
import { ReviewDialog } from "./ReviewDialog";

interface Props {
  path: string;
  revision: string;
  onOpen: (path: string) => void;
  onSaved: () => void;
}

type Tab = "rules" | "source" | "refs";

/**
 * One policy or resource, two ways: the structured view of its rules, and its source. Editing
 * happens in the source today (XML-first); a change is reviewed as a diff with the core's dry
 * run before it is written through `artifact.set-content`.
 */
export function ArtifactView({ path, revision, onOpen, onSaved }: Props) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("rules");
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [review, setReview] = useState<{ result: OpResult | null; error: string | null; busy: boolean } | null>(null);
  const [changedOnDisk, setChangedOnDisk] = useState(false);

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
        setTab((t) => (t === "rules" && a.kind !== "dirxml-script" ? "source" : t));
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

  const submit = async (dryRun: boolean) => {
    if (draft === null) {
      return;
    }
    setReview((r) => ({ result: dryRun ? null : (r?.result ?? null), error: null, busy: true }));
    try {
      const current = (await api.session()).revision;
      const result = await api.run("artifact.set-content", { args: { path: artifact.path }, files: { "content-file": draft }, dryRun, revision: current });
      if (!dryRun && result.ok) {
        setReview(null);
        await reload();
        onSaved();
        return;
      }
      setReview({ result, error: null, busy: false });
    } catch (e) {
      const message = e instanceof ApiError && e.status === 409 ? "The tree changed on disk while you were editing. Cancel, reload the artifact, and re-apply your change." : e instanceof Error ? e.message : String(e);
      setReview((r) => ({ result: r?.result ?? null, error: message, busy: false }));
    }
  };

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
              <button
                className="primary"
                disabled={!dirty}
                onClick={() => {
                  setReview({ result: null, error: null, busy: true });
                  void submit(true);
                }}
              >
                Review changes
              </button>
            </>
          )}
        </div>
      </div>
      {changedOnDisk && <div className="banner warn">This artifact's tree changed on disk while you were editing. Your edit is kept; applying it will be refused until you reload.</div>}
      {artifact.packaged && editing && <div className="banner warn">This artifact came from a package. Saving marks it customized, as Designer does.</div>}
      <div className="tabs">
        {artifact.kind === "dirxml-script" && (
          <button className={tab === "rules" ? "tab active" : "tab"} onClick={() => setTab("rules")}>
            Rules
          </button>
        )}
        <button className={tab === "source" ? "tab active" : "tab"} onClick={() => setTab("source")}>
          Source{dirty ? " •" : ""}
        </button>
        <button className={tab === "refs" ? "tab active" : "tab"} onClick={() => setTab("refs")}>
          References <span className="count">{artifact.refs.length}</span>
        </button>
      </div>
      {tab === "rules" && summary && (
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
                  {r.conditions.length === 0 ? <p className="muted">always</p> : <ul>{r.conditions.map((c, i) => <li key={i}><code>{c}</code></li>)}</ul>}
                </div>
                <div>
                  <h4>Do</h4>
                  {r.actions.length === 0 ? <p className="muted">nothing</p> : <ol>{r.actions.map((a, i) => <li key={i}><code>{a}</code></li>)}</ol>}
                </div>
              </div>
            </section>
          ))}
          <p className="muted small pad">The structured view is read-only in this spike. Edit in Source; the rule list follows what you type.</p>
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
      {review && draft !== null && (
        <ReviewDialog
          title={`Review changes to ${artifact.name}`}
          language={artifact.language}
          original={artifact.content}
          modified={draft}
          result={review.result}
          error={review.error}
          busy={review.busy}
          onCancel={() => setReview(null)}
          onApply={() => void submit(false)}
        />
      )}
    </div>
  );
}
