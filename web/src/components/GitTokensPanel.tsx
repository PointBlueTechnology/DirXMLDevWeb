import { useEffect, useState } from "react";
import { api } from "../api";
import type { GitTokenHost } from "../types";
import { ManagerPicker } from "./ManagerPicker";

/**
 * Your Git provider tokens (#35 P2, docs/pull-requests.md §3): one per provider host the server's projects use.
 * With one, a pull request you create is yours on the provider; without, the project's token creates it and the
 * description says you opened it. Kept in your own file, write-only, in the forms every credential here takes.
 */
export function GitTokensPanel({ helpers, commands = true }: { helpers: string; commands?: boolean }) {
  const [hosts, setHosts] = useState<GitTokenHost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [store, setStore] = useState("file");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = () =>
    api.connections
      .gitTokens()
      .then((r) => (setHosts(r.hosts), setError(null)))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  if (error) {
    return <p className="err-text small">{error}</p>;
  }
  if (!hosts || hosts.length === 0) {
    return null;
  }
  const start = (h: string) => (setEditing(h), setStore("file"), setValue(""), setNote(null));
  const ready = store === "file" || store === "env" || store === "command" || store === "manager" ? value.trim() !== "" : false;
  const save = async () => {
    if (!editing) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const arg = store === "file" ? "file" : store === "env" ? `env:${value.trim()}` : `command:${value.trim()}`;
      const r = await api.connections.saveGitToken({ host: editing, store: arg, ...(store === "file" ? { token: value } : {}) });
      setNote(r.notes.join("; "));
      setEditing(null);
      setValue("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const forget = async (h: string) => {
    setBusy(true);
    try {
      await api.connections.removeGitToken(h);
      setNote(`forgot your token for ${h}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="block" data-testid="git-tokens">
      <h3>My Git provider tokens</h3>
      <p className="muted small">
        With your own token, a pull request you create from the bar is yours on the provider. Without one, the project's token creates it and the description says you opened it. GitHub: a fine-grained token with <em>Pull requests: read and write</em> on the
        repository. GitLab: a token with the <em>api</em> scope. Kept in your own file and never shown again.
      </p>
      <table className="grid">
        <thead>
          <tr>
            <th>Host</th>
            <th>Provider</th>
            <th>Projects</th>
            <th>Your token</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {hosts.map((h) => (
            <tr key={h.host} className={editing === h.host ? "selected" : ""}>
              <td>
                <code>{h.host}</code>
              </td>
              <td>{h.provider}</td>
              <td className="small">{h.projects.join(", ")}</td>
              <td>{h.refused ? <span className="pill warn" title="Kept in your file, but a command runs on the server as the server: only a deployer's are used.">command (deployers only)</span> : h.set ? <span className="pill ok">{h.store === "file" ? "in your file" : h.store?.startsWith("env:") ? `from ${h.store.substring(4)}` : `from a ${h.store}`}</span> : <span className="muted">none: the project's token is used</span>}</td>
              <td className="right">
                <button onClick={() => start(h.host)} disabled={busy} data-testid={"git-token-set-" + h.host}>
                  {h.set ? "Replace…" : "Add…"}
                </button>{" "}
                {h.set && (
                  <button onClick={() => void forget(h.host)} disabled={busy} data-testid={"git-token-forget-" + h.host}>
                    Forget
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <div className="addrow" data-testid="git-token-form">
          <select value={store} onChange={(e) => (setStore(e.target.value), setValue(""))} data-testid="git-token-store">
            <option value="file">keep it in my file (readable by me only)</option>
            {commands && <option value="manager">read it from a secret manager</option>}
            <option value="env">read it from an environment variable</option>
            {commands && <option value="command">read it from a command's output</option>}
          </select>
          {store === "file" ? (
            <input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`your ${editing} token`} autoComplete="new-password" data-testid="git-token-value" />
          ) : store === "manager" ? null : (
            <input className="wide" value={value} onChange={(e) => setValue(e.target.value)} placeholder={store === "env" ? "VARIABLE_NAME" : "a command printing the token"} spellCheck={false} />
          )}
          <button className="primary" onClick={() => void save()} disabled={!ready || busy} data-testid="git-token-save">
            Save
          </button>
          <button onClick={() => setEditing(null)} disabled={busy}>
            Cancel
          </button>
        </div>
      )}
      {editing && store === "manager" && <ManagerPicker helpers={helpers} onCommand={(c) => setValue(c)} />}
      {note && <p className="ok-text small">{note}</p>}
    </section>
  );
}
