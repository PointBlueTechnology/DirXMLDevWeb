import { useEffect, useState } from "react";
import { api } from "../api";
import type { ConnectionEnv, Connections, EnvSecrets } from "../types";
import { ManagerPicker } from "./ManagerPicker";

const TIERS = ["dev", "stg", "prd"];

/**
 * Connections and credentials: the environments the `idm` CLI reads, each with its vault URL,
 * bind DN, driver set, tier and how its password is kept; a connection test before saving; and
 * the driver secrets each environment's deploys need. A password or secret typed here is sent
 * once to the local server and stored (Keychain by default on macOS, else an owner-only file);
 * the page is never shown a value again.
 */
export function ConnectionsView({ initialEnv }: { initialEnv: string | null }) {
  const [data, setData] = useState<Connections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null | "new">(initialEnv ?? null);

  const load = () =>
    api.connections
      .list()
      .then((d) => (setData(d), setError(null)))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data) {
    return <p className="muted pad">Loading…</p>;
  }
  const current = editing && editing !== "new" ? (data.environments.find((e) => e.name === editing) ?? null) : null;

  return (
    <div className="view connections">
      <div className="viewhead">
        <div>
          <div className="kicker">{data.file}{data.exists ? "" : " (not there yet; saving creates it, readable by you only)"}</div>
          <h2>Connections</h2>
        </div>
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing("new")} data-testid="conn-new">
          New environment
        </button>
      </div>
      <div className="pad scroll connbody">
        <table className="grid" data-testid="conn-table">
          <thead>
            <tr>
              <th>Environment</th>
              <th>Tier</th>
              <th>Vault</th>
              <th>Bind as</th>
              <th>Password</th>
              <th>Secrets file</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.environments.map((e) => (
              <tr key={e.name} className={editing === e.name ? "selected" : ""}>
                <td>
                  <code>{e.name}</code>
                  {!e.ready && (
                    <span className="pill warn" title="URL, bind DN, driver set or password missing">
                      incomplete
                    </span>
                  )}
                </td>
                <td>
                  <span className={e.tier === "prd" ? "pill err" : "pill"}>{e.tier ?? "dev"}</span>
                </td>
                <td className="small">
                  {e.url ?? <span className="muted">—</span>}
                  {e.trustAll === "true" && <span className="muted"> (any certificate)</span>}
                </td>
                <td className="small">{e.bindDn ?? <span className="muted">—</span>}</td>
                <td>{e.password ? <span className="pill ok">{e.password}</span> : <span className="pill err">none</span>}</td>
                <td className="small muted">{e.secretsFileExists ? "yes" : "none yet"}</td>
                <td className="right">
                  <button onClick={() => setEditing(e.name)} data-testid={"conn-edit-" + e.name}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.environments.length === 0 && <p className="muted">No environments yet. Add one: the vault's LDAPS URL, the account to bind as and its password, and the driver set's DN.</p>}
        {editing === "new" && <EnvForm key="new" env={null} keychain={data.keychain} helpers={data.helpers} onDone={(name) => (void load(), setEditing(name))} onCancel={() => setEditing(null)} />}
        {current && (
          <>
            <EnvForm key={current.name} env={current} keychain={data.keychain} helpers={data.helpers} onDone={() => void load()} onCancel={() => setEditing(null)} onRemoved={() => (void load(), setEditing(null))} />
            <SecretsPanel key={"s" + current.name} env={current.name} keychain={data.keychain} helpers={data.helpers} />
          </>
        )}
      </div>
    </div>
  );
}

function EnvForm({
  env,
  keychain,
  helpers,
  onDone,
  onCancel,
  onRemoved,
}: {
  env: ConnectionEnv | null;
  keychain: boolean;
  helpers: string;
  onDone: (name: string) => void;
  onCancel: () => void;
  onRemoved?: () => void;
}) {
  const [f, setF] = useState({
    name: env?.name ?? "",
    url: env?.url ?? "ldaps://",
    bindDn: env?.bindDn ?? "",
    driverSet: env?.driverSet ?? "",
    tier: env?.tier ?? "dev",
    trustAll: env?.trustAll === "true",
    sshHost: env?.sshHost ?? "",
    sshUser: env?.sshUser ?? "",
    password: "",
    store: keychain ? "keychain" : "file",
    ref: "",
  });
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isNew = env === null;
  const refStore = f.store === "env" || f.store === "command" || f.store === "manager";
  const passwordGiven = f.password.length > 0;
  const storeArg = f.store === "manager" ? `command:${f.ref}` : refStore ? `${f.store}:${f.ref}` : f.store;
  const canSave = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(f.name) && f.url.length > 8 && f.bindDn && f.driverSet && (isNew ? passwordGiven || (refStore && f.ref) : true);

  const runTest = () => {
    setBusy("Connecting…");
    setTest(null);
    setError(null);
    api.connections
      .test({ url: f.url, bindDn: f.bindDn, trustAll: f.trustAll, driverSet: f.driverSet, ...(passwordGiven ? { password: f.password } : { env: env?.name }) })
      .then(setTest)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  const save = () => {
    setBusy("Saving…");
    setError(null);
    const req: Record<string, unknown> = { name: f.name, url: f.url, bindDn: f.bindDn, driverSet: f.driverSet, tier: f.tier, trustAll: f.trustAll, sshHost: f.sshHost, sshUser: f.sshUser };
    if (passwordGiven || (refStore && f.ref)) {
      req.passwordStore = storeArg;
      if (passwordGiven) {
        req.password = f.password;
      }
    }
    api.connections
      .save(req)
      .then((r) => {
        setNotes(r.notes);
        setF({ ...f, password: "" });
        onDone(r.name);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  const remove = () => {
    setBusy("Removing…");
    api.connections
      .remove(f.name)
      .then(() => onRemoved?.())
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  return (
    <section className="block connform" data-testid="conn-form">
      <h3>{isNew ? "New environment" : env!.name}</h3>
      <div className="attrs">
        {isNew && (
          <label className="field">
            <em>Name</em>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="stg" spellCheck={false} data-testid="conn-name" />
          </label>
        )}
        <label className="field">
          <em>Tier</em>
          <select value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field wide">
          <em>Vault URL</em>
          <input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="ldaps://vault.example.com:636" spellCheck={false} data-testid="conn-url" />
        </label>
        <label className="field wide">
          <em>Bind DN</em>
          <input value={f.bindDn} onChange={(e) => setF({ ...f, bindDn: e.target.value })} placeholder="cn=admin,ou=sa,o=system" spellCheck={false} data-testid="conn-binddn" />
        </label>
        <label className="field wide">
          <em>Driver set DN</em>
          <input value={f.driverSet} onChange={(e) => setF({ ...f, driverSet: e.target.value })} placeholder="cn=driverset1,o=system" spellCheck={false} data-testid="conn-driverset" />
        </label>
        <label className="checkchip">
          <input type="checkbox" checked={f.trustAll} onChange={(e) => setF({ ...f, trustAll: e.target.checked })} /> accept any certificate (a lab or a tunnel; never production)
        </label>
        <label className="field">
          <em>SSH host (for trace)</em>
          <input value={f.sshHost} onChange={(e) => setF({ ...f, sshHost: e.target.value })} spellCheck={false} />
        </label>
        <label className="field">
          <em>SSH user</em>
          <input value={f.sshUser} onChange={(e) => setF({ ...f, sshUser: e.target.value })} spellCheck={false} />
        </label>
      </div>
      <h4>Password</h4>
      {!isNew && <p className="muted small">Configured: {env!.password ? `from the ${env!.password === "literal" ? "file" : env!.password}` : "none"}. Leave the field empty to keep it.</p>}
      <div className="addrow">
        <select value={f.store} onChange={(e) => setF({ ...f, store: e.target.value })} data-testid="conn-store">
          {keychain && <option value="keychain">keep it in the macOS Keychain</option>}
          <option value="file">keep it in the environments file (readable by you only)</option>
          <option value="manager">read it from a secret manager (AWS, Azure, GCP, CyberArk, BeyondTrust, Bitwarden…)</option>
          <option value="env">read it from an environment variable</option>
          <option value="command">read it from a command's output</option>
        </select>
        {f.store === "manager" ? null : refStore ? (
          <input className="wide" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder={f.store === "env" ? "VARIABLE_NAME" : "op read op://vault/item/password"} spellCheck={false} />
        ) : (
          <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={isNew ? "password" : "new password"} autoComplete="new-password" data-testid="conn-password" />
        )}
      </div>
      {f.store === "manager" && <ManagerPicker helpers={helpers} onCommand={(c) => setF((cur) => ({ ...cur, ref: c }))} />}
      <div className="addrow">
        <button onClick={runTest} disabled={busy !== null || !f.url || !f.bindDn || (!passwordGiven && isNew)} data-testid="conn-test">
          Test connection
        </button>
        <button className="primary" onClick={save} disabled={busy !== null || !canSave} data-testid="conn-save">
          Save
        </button>
        <button onClick={onCancel}>Close</button>
        {!isNew &&
          (confirmRemove ? (
            <>
              <button className="danger" onClick={remove} disabled={busy !== null}>
                Remove {env!.name} from the file
              </button>
              <button onClick={() => setConfirmRemove(false)}>Keep it</button>
            </>
          ) : (
            <button onClick={() => setConfirmRemove(true)}>Remove…</button>
          ))}
        {busy && <span className="muted">{busy}</span>}
      </div>
      {test && (
        <p className={test.ok ? "ok-text" : "err-text"} data-testid="conn-test-result">
          {test.message}
        </p>
      )}
      {error && <div className="banner error">{error}</div>}
      {notes.map((n, i) => (
        <p key={i} className="ok-text small">
          {n}
        </p>
      ))}
      <p className="muted small">The password is sent once to the local server and stored where you chose; this page never shows it again. A test with a typed password uses it without saving.</p>
    </section>
  );
}

function SecretsPanel({ env, keychain, helpers }: { env: string; keychain: boolean; helpers: string }) {
  const [data, setData] = useState<EnvSecrets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [store, setStore] = useState(keychain ? "keychain" : "file");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [extra, setExtra] = useState({ key: "", value: "" });
  const [ref, setRef] = useState({ key: "", command: "" });

  const load = () =>
    api.connections
      .secrets(env)
      .then((d) => (setData(d), setError(null)))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env]);

  const set = (key: string, value: string, how: string) => {
    setBusy(key);
    setNote(null);
    api.connections
      .setSecret({ env, key, store: how, ...(value ? { value } : {}) })
      .then((r) => {
        setNote(`${key}: ${r.notes.join("; ") || "saved"}`);
        setValues({ ...values, [key]: "" });
        return load();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const check = (key: string) => {
    setBusy(key);
    setNote(null);
    api.connections
      .resolve({ env, key })
      .then((r) => setNote((r.ok ? "✓ " : "✗ ") + r.message))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data) {
    return <p className="muted pad">Reading what the tree's drivers need…</p>;
  }
  const missing = data.needs.filter((n) => !n.configured).length;
  return (
    <section className="block" data-testid="conn-secrets">
      <h3>Driver secrets for {env}</h3>
      <p className="muted small">
        What the tree's drivers need when deployed to {env}, kept in <code>{data.file}</code>{data.exists ? "" : " (created on first save)"}. {missing === 0 ? "Everything needed is configured." : `${missing} not configured.`}
      </p>
      <div className="addrow tight">
        <span className="small">Store new values</span>
        <select value={store} onChange={(e) => setStore(e.target.value)}>
          {keychain && <option value="keychain">in the macOS Keychain</option>}
          <option value="file">in the secrets file (readable by you only)</option>
        </select>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>Driver</th>
            <th>Secret</th>
            <th>Why</th>
            <th>Configured</th>
            <th>Value</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.needs.map((n) => (
            <tr key={n.key}>
              <td>{n.driver}</td>
              <td>
                <code>{n.kind === "named" ? n.key.slice(n.driver.length + 1) : n.kind}</code>
              </td>
              <td className="muted small">{n.because}</td>
              <td>{n.configured ? <span className="pill ok">{n.configured}</span> : <span className="pill err">no</span>}</td>
              <td className="vcell">
                <input type="password" value={values[n.key] ?? ""} onChange={(e) => setValues({ ...values, [n.key]: e.target.value })} autoComplete="new-password" placeholder={n.configured ? "replace…" : "set…"} />
              </td>
              <td className="right">
                <button disabled={!values[n.key] || busy !== null} onClick={() => set(n.key, values[n.key]!, store)}>
                  Save
                </button>{" "}
                {n.configured && (
                  <>
                    <button disabled={busy !== null} onClick={() => check(n.key)} title="Read it and say whether a value came back">
                      Check
                    </button>{" "}
                    <button disabled={busy !== null} onClick={() => set(n.key, "", "remove")}>
                      Remove
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {data.others.map((o) => (
            <tr key={o.key}>
              <td className="muted">—</td>
              <td>
                <code>{o.key}</code>
              </td>
              <td className="muted small">in the file, not needed by this tree</td>
              <td>
                <span className="pill">{o.configured}</span>
              </td>
              <td />
              <td className="right">
                <button disabled={busy !== null} onClick={() => set(o.key, "", "remove")}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.needs.length === 0 && data.others.length === 0 && <p className="muted">The tree's drivers need no secrets.</p>}
      <div className="addrow">
        <strong className="small">Another secret</strong>
        <input className="wide" placeholder="key, e.g. AD Driver.named.exchange-service or driverset.named.smtp-relay" value={extra.key} onChange={(e) => setExtra({ ...extra, key: e.target.value })} spellCheck={false} />
        <input type="password" placeholder="value" value={extra.value} onChange={(e) => setExtra({ ...extra, value: e.target.value })} autoComplete="new-password" />
        <button disabled={!extra.key || !extra.value || busy !== null} onClick={() => (set(extra.key, extra.value, store), setExtra({ key: "", value: "" }))}>
          Save
        </button>
      </div>
      <h4>A secret read from a secret manager</h4>
      <div className="addrow tight">
        <span className="small">Secret</span>
        <input list="secretkeys" className="wide" placeholder="key, e.g. AD Driver.shim-auth-password" value={ref.key} onChange={(e) => setRef({ ...ref, key: e.target.value })} spellCheck={false} data-testid="secret-ref-key" />
        <datalist id="secretkeys">
          {data.needs.map((n) => (
            <option key={n.key} value={n.key} />
          ))}
        </datalist>
      </div>
      <ManagerPicker helpers={helpers} onCommand={(c) => setRef((cur) => ({ ...cur, command: c }))} />
      <div className="addrow tight">
        <button disabled={!ref.key || !ref.command || busy !== null} onClick={() => (set(ref.key, "", `command:${ref.command}`), setRef({ key: "", command: ref.command }))} data-testid="secret-ref-save">
          Save the reference
        </button>
      </div>
      {note && <p className="ok-text small">{note}</p>}
    </section>
  );
}
