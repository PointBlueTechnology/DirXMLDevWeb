import { useEffect, useState } from "react";
import { api, type AgentToken } from "../api";

/**
 * A person's tokens for their agents (docs/agents.md): an agent with one acts as them, through the MCP endpoint or the
 * API, under their roles. A token's value is shown once, with the command that connects Claude Code; afterwards only its
 * label, dates and last use. The agent kit (rules, skills, docs for this version) downloads from here too.
 */
export function AgentTokensDialog({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<AgentToken[] | null>(null);
  const [limits, setLimits] = useState({ maxDays: 365, defaultDays: 90 });
  const [label, setLabel] = useState("claude");
  const [days, setDays] = useState(90);
  const [made, setMade] = useState<AgentToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupPrompt, setSetupPrompt] = useState("");
  const mcpUrl = `${window.location.origin}/mcp`;
  const load = () =>
    api.agentTokens
      .list()
      .then((r) => (setTokens(r.tokens), setSetupPrompt(r.setupPrompt), setLimits({ maxDays: r.maxDays, defaultDays: r.defaultDays }), setDays((d) => Math.min(d, r.maxDays))))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const create = () => {
    setBusy(true);
    setError(null);
    api.agentTokens
      .create(label.trim(), days)
      .then((t) => (setMade(t), void load()))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const revoke = (t: AgentToken) => {
    if (!window.confirm(`Revoke "${t.label}"? An agent using it stops working at once.`)) {
      return;
    }
    api.agentTokens
      .revoke(t.id)
      .then(() => load())
      .catch((e: Error) => setError(e.message));
  };
  const kit = () =>
    api.agentTokens
      .kit()
      .then(({ blob, fileName }) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((e: Error) => setError(e.message));
  const command = made?.token ? `claude mcp add --transport http dirxmldev ${mcpUrl} --header "Authorization: Bearer ${made.token}"` : "";
  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal narrow" data-testid="agent-tokens">
        <div className="modal-head">
          <h3>Agent tokens</h3>
          <span className="muted small">An agent with one of your tokens acts as you: your roles, your connections, your workspace. The audit log names the token.</span>
        </div>
        <div className="pad">
          {made?.token && (
            <div className="banner ok" data-testid="agent-token-made">
              <strong>&quot;{made.label}&quot; is made. Copy it now: it is not shown again.</strong>
              <pre className="outcome small">{made.token}</pre>
              <p className="small">Connect Claude Code (keep the token out of files you commit):</p>
              <pre className="outcome small">{command}</pre>
              <button onClick={() => void navigator.clipboard.writeText(command)}>Copy the command</button>
            </div>
          )}
          <h4>Make one</h4>
          <div className="addrow">
            <label className="field">
              <em>Label</em>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. claude-laptop" maxLength={60} data-testid="agent-token-label" />
            </label>
            <label className="field">
              <em>Expires after</em>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[7, 30, 90, 180, 365].filter((d) => d <= limits.maxDays).map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={create} disabled={busy || !label.trim()} data-testid="agent-token-create">
              Make the token
            </button>
          </div>
          <h4>Yours</h4>
          {tokens === null ? (
            <p className="muted small">…</p>
          ) : tokens.length === 0 ? (
            <p className="muted small">None yet.</p>
          ) : (
            <table className="grid small">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Made</th>
                  <th>Expires</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td>{t.label}</td>
                    <td>{t.created.slice(0, 10)}</td>
                    <td className={t.expired ? "err-text" : ""}>{t.expires.slice(0, 10)}{t.expired ? " (expired)" : ""}</td>
                    <td>{t.lastUsed ? t.lastUsed.slice(0, 16).replace("T", " ") : "never"}</td>
                    <td>
                      <button className="link" onClick={() => revoke(t)}>
                        revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h4>Set up your agent</h4>
          <ol className="small">
            <li>
              Connect it with a token (above): for Claude Code, the <code>claude mcp add …</code> command shown when you make one, with <code>{mcpUrl}</code>.
            </li>
            <li>
              In Claude Code, run <code>/mcp__dirxmldev__setup</code>. In another agent, paste this; it holds no secret:
              <pre className="outcome small" data-testid="agent-setup-prompt">{setupPrompt}</pre>
              <button onClick={() => void navigator.clipboard.writeText(setupPrompt)} disabled={!setupPrompt}>
                Copy the prompt
              </button>
            </li>
          </ol>
          <p className="muted small">It reads the rules, installs the skills from the server, then looks around without changing anything.</p>
          <p className="small">
            Then ask it in your own words. It works on the project and branch you last had open here (<code>session</code> says which), previews every edit before
            applying it, and shows you the plan before a deploy; a deploy, rollback or driver start or stop needs you to type the environment&apos;s name in the chat.{" "}
            <a href="https://github.com/PointBlueTechnology/DirXMLDevWeb/blob/main/docs/agents.md" target="_blank" rel="noreferrer" className="link">
              How agents work with this server
            </a>
          </p>
          <h4>The agent kit</h4>
          <p className="small">
            This version&apos;s rules (<code>AGENTS.md</code>), skills and docs, with this server&apos;s MCP address (<code>{mcpUrl}</code>). Unzip it where you start your
            agent, or copy its <code>.claude/skills</code> into your own.
          </p>
          <button onClick={() => void kit()} data-testid="agent-kit-download">
            Download the agent kit
          </button>
          {error && <p className="err-text">{error}</p>}
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
