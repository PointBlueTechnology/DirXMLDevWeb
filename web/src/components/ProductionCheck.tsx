import { useState } from "react";
import { GIT_CHANGED, api } from "../api";
import type { DeployResult } from "../types";

/**
 * What stands between a plan and a production deploy (#136), in the page's words, with the way on as a button:
 * capture the vault's state, push, get the latest base, or what to do elsewhere. The core's own words stay
 * one click away.
 */
export function ProductionCheck({ env, kind, message, busy, onCapture, onDone }: { env: string; kind: string | null | undefined; message: string; busy: boolean; onCapture: () => void; onDone: () => void }) {
  const [working, setWorking] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (what: string, fn: () => Promise<string>) => {
    setWorking(what);
    setNote(null);
    fn()
      .then((text) => (setNote({ ok: true, text }), window.dispatchEvent(new Event(GIT_CHANGED)), onDone()))
      .catch((e: Error) => setNote({ ok: false, text: e.message }))
      .finally(() => setWorking(null));
  };
  const requires = /to '([^']+)' first/.exec(message)?.[1];
  const base = /comes from (\S+?)[;:]/.exec(message)?.[1] ?? /Get latest (\S+)/.exec(message)?.[1] ?? "main";
  let title: string;
  let body: string;
  let action: JSX.Element | null = null;
  switch (kind) {
    case "unknown-state":
      title = `${env}'s current state isn't on record`;
      body = `No deploy to ${env} is recorded in this repository yet, so the page can't tell what the vault holds now. Capture it first: the page reads ${env} and records what it holds on a branch of its own. Nothing is written to the vault.`;
      action = (
        <button className="primary" onClick={onCapture} disabled={busy} data-testid="gate-capture">
          Capture {env}'s current state
        </button>
      );
      break;
    case "drift":
      title = `${env} changed since the last deploy on record`;
      body = `Someone changed the vault outside this repository (Designer, iManager, another tool). Capture its current state, so that your change goes on top of theirs instead of undoing it. Nothing is written to the vault.`;
      action = (
        <button className="primary" onClick={onCapture} disabled={busy} data-testid="gate-capture">
          Capture {env}'s current state
        </button>
      );
      break;
    case "requires":
      title = `${env} takes only what ${requires ?? "test"} has had`;
      body = `Deploy this to ${requires ?? "the test environment"} first. A commit that differs only in deploy records counts as the same.`;
      break;
    case "branch":
      title = `Production deploys come from ${base}`;
      body = `Merge this branch into ${base} (Merge into ${base}… or a pull request, on the bar at the top), then open ${base} and deploy from there. A production vault can allow any branch under Connections → More settings.`;
      break;
    case "push":
      title = "Push first";
      body = `This copy has commits the repository's ${base} doesn't, and production takes what ${base} holds.`;
      action = (
        <button className="primary" onClick={() => run("Pushing…", async () => (await api.git.commit("", true)).message ?? "pushed")} disabled={busy || working !== null} data-testid="gate-push">
          Push
        </button>
      );
      break;
    case "behind":
      title = `Get the latest ${base} first`;
      body = `Others merged into ${base} since this copy was taken. Production takes what ${base} holds, so bring it in, then test it.`;
      action = (
        <button className="primary" onClick={() => run("Updating…", async () => (await api.git.update()).message)} disabled={busy || working !== null} data-testid="gate-get-latest">
          Get latest {base}
        </button>
      );
      break;
    case "uncommitted":
      title = "Commit first";
      body = "Production records the commit it deploys, so nothing may be uncommitted. Commit your changes from the bar at the top.";
      break;
    case "not-in-git":
      title = "The tree isn't in git";
      body = "Production records the commit it deploys. Put the tree in a repository first.";
      break;
    default:
      title = "A production deploy would be refused";
      body = message;
  }
  return (
    <div className="banner warn gate" data-testid={"gate-" + (kind ?? "other")}>
      <strong>{title}</strong>
      <p className="small">{body}</p>
      {action}
      {working && <span className="muted small"> {working}</span>}
      {note && <p className={note.ok ? "ok-text small" : "err-text small"}>{note.text}</p>}
      {kind && body !== message && (
        <details className="small">
          <summary>The check's own words</summary>
          <pre className="outcome">{message}</pre>
        </details>
      )}
    </div>
  );
}

/**
 * After a capture (#136): what it found, and the steps on, as buttons — merge the captured state under this branch,
 * commit and push the record, compare again.
 */
export function CaptureSteps({ env, result, onCompare }: { env: string; result: DeployResult; onCompare: () => void }) {
  const [merged, setMerged] = useState<{ ok: boolean; text: string; conflicts?: string[] } | null>(null);
  const [recorded, setRecorded] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const branch = result.capturedBranch;
  const merge = () => {
    if (!branch) {
      return;
    }
    setWorking("Merging…");
    api.git
      .mergeCaptured(branch)
      .then((r) => (setMerged({ ok: r.merged, text: r.message, conflicts: r.conflicts }), window.dispatchEvent(new Event(GIT_CHANGED))))
      .catch((e: Error) => setMerged({ ok: false, text: e.message }))
      .finally(() => setWorking(null));
  };
  const record = () => {
    setWorking("Committing and pushing…");
    api.git
      .commitRecord(`Record ${env}'s state`)
      .then(async (r) => {
        const pushed = await api.git.commit("", true).catch((e: Error) => ({ message: "not pushed: " + e.message, pushed: false }));
        setRecorded({ ok: true, text: `${r.committed ? `committed ${r.hash}` : "nothing new to commit"}; ${pushed.message ?? "pushed"}` });
        window.dispatchEvent(new Event(GIT_CHANGED));
      })
      .catch((e: Error) => setRecorded({ ok: false, text: e.message }))
      .finally(() => setWorking(null));
  };
  if (result.refusal) {
    return <div className="banner error">{result.refusal}</div>;
  }
  if (result.gateKind === "known") {
    return (
      <div className="banner ok" data-testid="capture-known">
        <strong>{env} matches the last deploy on record.</strong> Its state is known; nothing to capture.{" "}
        <button className="link" onClick={onCompare}>
          Compare again
        </button>
      </div>
    );
  }
  const captured = result.gateKind === "captured" && branch;
  return (
    <div className="block capture" data-testid="capture-steps">
      <h4>{captured ? `${env}'s state is captured` : `${env} matches a commit exactly`}</h4>
      <ol className="steps">
        <li className="done">
          {captured ? (
            <>
              Captured as <code>{branch}</code>, and recorded as {env}'s known state. Nothing was written to the vault.
            </>
          ) : (
            <>The vault matches a commit of this repository; recorded that as {env}'s known state.</>
          )}
        </li>
        {captured && (
          <li className={merged?.ok ? "done" : ""}>
            <button onClick={merge} disabled={working !== null || merged?.ok === true} data-testid="capture-merge">
              Merge it into this branch
            </button>{" "}
            <span className="muted small">your work goes on top of what {env} holds</span>
            {merged && (
              <div className={merged.ok ? "ok-text small" : "err-text small"}>
                {merged.text}
                {(merged.conflicts ?? []).map((c) => (
                  <div key={c}>
                    <code>{c}</code>
                  </div>
                ))}
              </div>
            )}
          </li>
        )}
        <li className={recorded?.ok ? "done" : ""}>
          <button onClick={record} disabled={working !== null || (captured ? merged?.ok !== true : false) || recorded?.ok === true} data-testid="capture-record">
            Commit and push the record
          </button>{" "}
          <span className="muted small">the deploy log now says what {env} holds</span>
          {recorded && <div className={recorded.ok ? "ok-text small" : "err-text small"}>{recorded.text}</div>}
        </li>
        <li>
          <button className="primary" onClick={onCompare} disabled={working !== null || recorded?.ok !== true} data-testid="capture-compare">
            Compare again
          </button>{" "}
          <span className="muted small">then plan and deploy your change</span>
        </li>
      </ol>
      {working && <span className="muted small">{working}</span>}
      <details className="small">
        <summary>What the capture said</summary>
        <pre className="outcome">{result.plan ?? result.text}</pre>
      </details>
    </div>
  );
}
