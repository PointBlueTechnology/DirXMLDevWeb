import { useState } from "react";
import { api } from "../api";
import type { PullRequestInfo, PullRequestRef } from "../types";

/**
 * Create pull request (#35, docs/pull-requests.md): a title, a body and a draft tick, sent through the provider's
 * API. Says whose account it is created as before Create; a refusal shows the provider's own words and the
 * compare page as the way on.
 */
export function PullRequestDialog({ info, onClose, onCreated }: { info: PullRequestInfo; onClose: () => void; onCreated: (r: PullRequestRef) => void }) {
  const [title, setTitle] = useState(info.title ?? "");
  const [body, setBody] = useState(info.body ?? "");
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = info.provider === "GitLab" ? "merge request" : "pull request";
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.git.createPullRequest({ title: title.trim(), body, draft });
      if (r.ok && r.request) {
        onCreated(r.request);
        return;
      }
      setError(r.error ?? "the provider did not create it");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal prdialog" data-testid="pr-dialog">
        <div className="modal-head">
          <h3>
            Create {noun}: {info.branch} into {info.base}
          </h3>
          <span className="muted small">
            On {info.provider}, as {info.as}
            {info.as === "the project's repository token" ? " (the description says you opened it; add your own token under Connections to open it as yourself)" : ""}.
          </span>
          {info.personalTokenError && <span className="err-text small">{info.personalTokenError}</span>}
        </div>
        <div className="modal-body pad">
          <label className="field wide">
            <em>Title</em>
            <input value={title} onChange={(e) => setTitle(e.target.value)} spellCheck={false} autoFocus data-testid="pr-title" />
          </label>
          <label className="field wide">
            <em>Description</em>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} data-testid="pr-body" />
          </label>
          <label className="checkchip">
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} data-testid="pr-draft" /> draft
          </label>
          {error && (
            <p className="err-text" data-testid="pr-error">
              {error}
              {info.compareUrl && (
                <>
                  {" "}
                  <a href={info.compareUrl} target="_blank" rel="noreferrer" className="link">
                    Open the compare page ↗
                  </a>
                </>
              )}
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={() => void create()} disabled={busy || !title.trim()} data-testid="pr-create">
            {busy ? "Creating…" : `Create ${noun}`}
          </button>
        </div>
      </div>
    </div>
  );
}
