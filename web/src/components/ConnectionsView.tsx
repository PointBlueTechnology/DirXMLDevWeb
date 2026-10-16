import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ConnectionEnv, Connections, EnvSecrets, ServerAddress, SignInCheck, VaultCertificate } from "../types";
import { ManagerPicker } from "./ManagerPicker";

/**
 * The vaults a project deploys to and how each person signs in to them (docs/connections-ui.md). One list with one
 * status and one action per vault; one form to add a vault, in the order its fields depend on each other (address,
 * certificate, sign-in, then the driver set looked up with that sign-in), required before optional; an environment's
 * sections under Edit. A password typed here is sent once and never shown again; a rotated one shows as
 * "password rejected" with Update password, which tests a new one before it replaces the old.
 */

const KINDS: { value: string; label: string }[] = [
  { value: "prd", label: "production" },
  { value: "stg", label: "test" },
  { value: "dev", label: "dev" },
];
const kindLabel = (t: string | null | undefined) => KINDS.find((k) => k.value === (t ?? "dev"))?.label ?? t ?? "dev";
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const RECHECK_MS = 5 * 60 * 1000;

/** AB:CD:… as certificate tools print a fingerprint. */
export function fingerprint(sha: string | null | undefined): string {
  return (sha ?? "").toUpperCase().replace(/(..)(?!$)/g, "$1:");
}

/** Signed in, as far as the files say: a bind DN and a password source of the person's own. */
const signedIn = (e: ConnectionEnv, split: boolean) => (split ? !!e.connected : !!e.bindDn && !!e.password);

type Status = { label: string; tone: "ok" | "warn" | "err" | "muted"; action: string; focus: "password" | "vault" | null; detail?: string };

function status(e: ConnectionEnv, split: boolean, c: SignInCheck | "checking" | undefined): Status {
  if (e.passwordRefused) {
    return { label: "password not usable here", tone: "err", action: "Update password", focus: "password", detail: "A reference is kept in your file, but only a deployer's are read on this server. Keep the password itself instead." };
  }
  if (!signedIn(e, split)) {
    return { label: "not signed in", tone: "warn", action: "Sign in", focus: "password" };
  }
  if (c === undefined) {
    return { label: "not checked", tone: "muted", action: "Edit", focus: null };
  }
  if (c === "checking") {
    return { label: "checking…", tone: "muted", action: "Edit", focus: null };
  }
  switch (c.state) {
    case "ok":
      if (c.graceRemaining != null) {
        return { label: `${c.graceRemaining} grace login${c.graceRemaining === 1 ? "" : "s"} left`, tone: "err", action: "Update password now", focus: "password", detail: "Your password has expired. Every vault call uses a grace login." };
      }
      if (c.daysLeft != null && c.daysLeft <= 14) {
        return { label: `password expires in ${Math.max(0, c.daysLeft)} day${c.daysLeft === 1 ? "" : "s"}`, tone: "warn", action: "Update password", focus: "password" };
      }
      return { label: "connected", tone: "ok", action: "Edit", focus: null };
    case "rejected":
      return { label: "password rejected", tone: "err", action: "Update password", focus: "password", detail: c.reason ?? c.message ?? undefined };
    case "certificate":
      return { label: c.pinned ? "certificate changed" : "certificate not trusted", tone: "err", action: "Fix", focus: "vault", detail: c.message ?? undefined };
    case "unreachable":
      return { label: "vault unreachable", tone: "warn", action: "Edit", focus: "vault", detail: c.message ?? undefined };
    default:
      return { label: "sign-in failed", tone: "err", action: "Fix", focus: "password", detail: c.message ?? undefined };
  }
}

const pillClass = (tone: Status["tone"]) => (tone === "ok" ? "pill ok" : tone === "warn" ? "pill warn" : tone === "err" ? "pill err" : "pill");

export function ConnectionsView({ initialEnv, deployer }: { initialEnv: string | null; deployer: boolean }) {
  const [data, setData] = useState<Connections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, SignInCheck | "checking">>({});
  const [mode, setMode] = useState<{ kind: "list" } | { kind: "add" } | { kind: "edit"; env: string; focus: "password" | "vault" | null }>(
    initialEnv ? { kind: "edit", env: initialEnv, focus: null } : { kind: "list" },
  );

  const load = () =>
    api.connections
      .list()
      .then((d) => (setData(d), setError(null), d))
      .catch((e: Error) => (setError(e.message), null));

  const check = (name: string, fresh: boolean) => {
    setChecks((c) => ({ ...c, [name]: c[name] && c[name] !== "checking" ? c[name] : "checking" }));
    return api.connections
      .check(name, fresh)
      .then((r) => setChecks((c) => ({ ...c, [name]: r })))
      .catch((e: Error) => setChecks((c) => ({ ...c, [name]: { state: "error", message: e.message } })));
  };
  const checkAll = (d: Connections | null, fresh: boolean) => {
    for (const e of d?.environments ?? []) {
      if (signedIn(e, d!.split) && !e.passwordRefused) {
        void check(e.name, fresh);
      }
    }
  };

  useEffect(() => {
    void load().then((d) => checkAll(d, false));
    const t = window.setInterval(() => {
      void load().then((d) => checkAll(d, true));
    }, RECHECK_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // opened for one environment (from a vault error, the top bar): its sign-in first when that is what needs doing
  useEffect(() => {
    if (initialEnv && data && mode.kind === "edit" && mode.env === initialEnv && mode.focus === null) {
      const e = data.environments.find((x) => x.name === initialEnv);
      if (e) {
        const s = status(e, data.split, checks[initialEnv]);
        if (s.focus) {
          setMode({ kind: "edit", env: initialEnv, focus: s.focus });
        }
      }
    }
  }, [initialEnv, data, checks, mode]);

  if (error) {
    return <div className="banner error">{error}</div>;
  }
  if (!data) {
    return <p className="muted pad">Loading…</p>;
  }
  const split = data.split;
  const editing = mode.kind === "edit" ? data.environments.find((e) => e.name === mode.env) ?? null : null;
  const reloadAndCheck = (name?: string) =>
    void load().then((d) => {
      window.setTimeout(() => window.dispatchEvent(new Event("idmweb:signin-changed")), 1500);
      if (name) {
        void check(name, true);
      } else {
        checkAll(d, true);
      }
    });

  return (
    <div className="view connections">
      <div className="viewhead">
        <div>
          <h2>Connections</h2>
          <div className="muted small">Vaults this project deploys to, and how you sign in to each.</div>
        </div>
        <span className="spacer" />
        <button onClick={() => reloadAndCheck()} title="Sign in to each vault again now" data-testid="conn-recheck">
          Check again
        </button>{" "}
        <button className="primary" onClick={() => setMode({ kind: "add" })} data-testid="conn-new">
          Add a vault
        </button>
      </div>
      <div className="pad scroll connbody">
        <table className="grid" data-testid="conn-table">
          <thead>
            <tr>
              <th>Environment</th>
              <th>Vault and driver set</th>
              <th>Your sign-in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.environments.map((e) => {
              const s = status(e, split, checks[e.name]);
              const c = checks[e.name];
              const checkedAt = c && c !== "checking" && c.checkedAt ? new Date(c.checkedAt).toLocaleTimeString() : null;
              return (
                <tr key={e.name} className={editing?.name === e.name ? "selected" : ""} data-testid={"conn-row-" + e.name}>
                  <td>
                    <code>{e.name}</code> <span className={e.tier === "prd" ? "pill err" : "pill"}>{kindLabel(e.tier)}</span>
                    {e.own && (
                      <span className="pill" title="Only in your own file">
                        only for you
                      </span>
                    )}
                  </td>
                  <td className="small">
                    {e.url ?? <span className="muted">no address</span>}
                    {e.driverSet && <span className="muted"> · {e.driverSet.replace(/,.*$/, "").replace(/^cn=/i, "")}</span>}
                    {e.trustAll === "true" && <div className="warn-text small">accepts any certificate: pin it under Edit</div>}
                    {c && c !== "checking" && (c.servers ?? 0) > 1 && (
                      <div className={(c.serversUnreachable?.length ?? 0) > 0 ? "warn-text small" : "muted small"}>
                        {c.servers} servers{(c.serversUnreachable?.length ?? 0) > 0 ? `, ${c.serversUnreachable!.length} unreachable (${c.serversUnreachable!.join(", ")})` : ""}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={pillClass(s.tone)} title={[s.detail, checkedAt ? `checked at ${checkedAt}` : null].filter(Boolean).join(" · ")} data-testid={"conn-status-" + e.name}>
                      {s.label}
                    </span>
                    {s.detail && s.tone === "err" && <div className="muted small">{s.detail}</div>}
                  </td>
                  <td className="right">
                    <button className={s.tone === "err" ? "danger" : ""} onClick={() => setMode({ kind: "edit", env: e.name, focus: s.focus })} data-testid={"conn-act-" + e.name}>
                      {s.action}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.environments.length === 0 && (
          <p className="muted">{deployer || !split ? "Add the project's first vault: its address, how you sign in, and the driver set." : "A deployer adds the project's vaults; you then sign in to each. Or add a vault only for you."}</p>
        )}
        <p className="muted small">Where a vault is, its certificate and driver set are the project's. Your sign-in is yours alone: kept in your own file, never shown again.</p>

        {mode.kind === "add" && (
          <AddVault
            key="add"
            data={data}
            deployer={deployer}
            onDone={(name) => (reloadAndCheck(name), setMode({ kind: "edit", env: name, focus: null }))}
            onCancel={() => setMode({ kind: "list" })}
          />
        )}
        {editing && (
          <EditVault
            key={editing.name + (mode.kind === "edit" ? mode.focus ?? "" : "")}
            env={editing}
            data={data}
            deployer={deployer}
            check={checks[editing.name]}
            focus={mode.kind === "edit" ? mode.focus : null}
            onSaved={() => reloadAndCheck(editing.name)}
            onClose={() => setMode({ kind: "list" })}
            onRemoved={() => (reloadAndCheck(), setMode({ kind: "list" }))}
          />
        )}

        <p className="muted small">Your Git tokens are under Projects → Repository.</p>
      </div>
    </div>
  );
}

// ---- the certificate ----

/**
 * What a vault's certificate is and whether it is trusted: by this server as is, by the pin, or not at all, with
 * "Trust this certificate" (a deployer, or the person for a vault only they use) pinning exactly what was shown.
 */
function CertificateBlock({ url, pin, trustAll, canPin, onPin }: { url: string; pin: string | null; trustAll: boolean; canPin: boolean; onPin: (sha: string) => void }) {
  const [cert, setCert] = useState<VaultCertificate | null>(null);
  const [busy, setBusy] = useState(false);
  const probe = () => {
    if (!/^ldaps:\/\/[^/]+/i.test(url)) {
      setCert(null);
      return;
    }
    setBusy(true);
    api.connections
      .certificate(url)
      .then(setCert)
      .catch((e: Error) => setCert({ ok: false, message: e.message }))
      .finally(() => setBusy(false));
  };
  useEffect(probe, [url]);

  if (!/^ldaps:\/\//i.test(url)) {
    return <p className="muted small">An ldap:// address has no certificate: its traffic, passwords included, is not encrypted. Use ldaps:// for anything but a lab.</p>;
  }
  if (busy && !cert) {
    return <p className="muted small">Reading the vault's certificate…</p>;
  }
  if (!cert) {
    return null;
  }
  if (!cert.ok) {
    return (
      <p className="warn-text small" data-testid="cert-unreachable">
        {cert.message}{" "}
        <button className="link" onClick={probe}>
          Try again
        </button>
      </p>
    );
  }
  const who = `${cert.subject}, issued by ${cert.issuer}, expires ${cert.notAfter ? new Date(cert.notAfter).toLocaleDateString() : "?"}`;
  const pinned = !!pin && cert.sha256 === pin;
  if (cert.trusted && !trustAll) {
    return (
      <p className="ok-text small" data-testid="cert-trusted">
        Certificate trusted by this server: {who}.
      </p>
    );
  }
  if (pinned) {
    return (
      <p className="ok-text small" data-testid="cert-pinned">
        Certificate pinned: {who}. SHA-256 <code>{fingerprint(cert.sha256)}</code>
      </p>
    );
  }
  const changed = !!pin && cert.sha256 !== pin;
  return (
    <div className={changed ? "banner error" : "banner warn"} data-testid={changed ? "cert-changed" : "cert-untrusted"}>
      {changed ? (
        <>
          The vault's certificate changed. It now presents SHA-256 <code>{fingerprint(cert.sha256)}</code>; you trusted <code>{fingerprint(pin)}</code>. Trust the new one only if you expected it to change.
        </>
      ) : trustAll ? (
        <>This vault accepts any certificate. Pin the one it presents now instead:</>
      ) : (
        <>Certificate not trusted by this server ({cert.problem ?? "unknown issuer"}). Check its fingerprint with the vault's administrator before you trust it.</>
      )}
      <div className="small">
        {who}
        <br />
        SHA-256 <code>{fingerprint(cert.sha256)}</code>
      </div>
      {canPin ? (
        <button onClick={() => onPin(cert.sha256!)} data-testid="cert-trust">
          {changed ? "Trust the new certificate" : "Trust this certificate"}
        </button>
      ) : (
        <div className="small">Ask a deployer to trust this vault's certificate.</div>
      )}{" "}
      <button className="link" onClick={probe}>
        Check again
      </button>
    </div>
  );
}

// ---- the password ----

type Store = { kind: string; ref: string };

/** Where a typed password goes, or the reference a deployer gives instead. */
function PasswordField({
  value,
  onChange,
  store,
  onStore,
  references,
  keychain,
  helpers,
  autoFocus,
  configured,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  store: Store;
  onStore: (s: Store) => void;
  references: boolean;
  keychain: boolean;
  helpers: string;
  autoFocus?: boolean;
  configured?: string | null;
  error?: string | null;
}) {
  const ref = store.kind === "env" || store.kind === "command" || store.kind === "manager";
  return (
    <div className="field wide">
      <em>Password</em>
      {ref ? (
        <>
          <span className="addrow tight">
            <select value={store.kind} onChange={(e) => onStore({ kind: e.target.value, ref: "" })}>
              <option value="manager">a secret manager (AWS, Azure, GCP, CyberArk, BeyondTrust, Bitwarden…)</option>
              <option value="env">an environment variable</option>
              <option value="command">a command's output</option>
            </select>
            {store.kind !== "manager" && <input className="wide" value={store.ref} onChange={(e) => onStore({ ...store, ref: e.target.value })} placeholder={store.kind === "env" ? "VARIABLE_NAME" : "op read op://vault/item/password"} spellCheck={false} />}
          </span>
          {store.kind === "manager" && <ManagerPicker helpers={helpers} onCommand={(c) => onStore({ kind: "manager", ref: c })} />}
          <span className="small">
            <button className="link" onClick={() => onStore({ kind: keychain && references ? "keychain" : "file", ref: "" })}>
              Type a password instead
            </button>
          </span>
        </>
      ) : (
        <>
          <input type="password" value={value} onChange={(e) => onChange(e.target.value)} placeholder={configured ? "new password" : "password"} autoComplete="new-password" autoFocus={autoFocus} data-testid="conn-password" />
          <span className="muted small">
            {configured ? `Password set (${configured === "literal" ? "in your file" : configured === "keychain" ? "in the Keychain" : `read from ${configured === "env" ? "an environment variable" : "a command"}`}). Type a new one to replace it. ` : ""}
            Stored for you only, never shown again.
            {references && (
              <>
                {" "}
                <button className="link" onClick={() => onStore({ kind: "manager", ref: "" })}>
                  Use a secret manager instead
                </button>
              </>
            )}
          </span>
        </>
      )}
      {error && <span className="err-text small">{error}</span>}
    </div>
  );
}

const storeArg = (s: Store) => (s.kind === "manager" ? `command:${s.ref}` : s.kind === "env" || s.kind === "command" ? `${s.kind}:${s.ref}` : s.kind);
const isRef = (s: Store) => s.kind === "env" || s.kind === "command" || s.kind === "manager";

function CheckLine({ result }: { result: { ok: boolean; message: string; check?: SignInCheck } | null }) {
  if (!result) {
    return null;
  }
  const c = result.check;
  const extra = c && c.state === "ok" && c.daysLeft != null && c.daysLeft <= 14 ? ` Your password expires in ${Math.max(0, c.daysLeft)} day(s).` : "";
  return (
    <p className={result.ok ? "ok-text small" : "err-text small"} data-testid="conn-test-result">
      {result.message}
      {extra}
    </p>
  );
}

// ---- add a vault ----

function AddVault({ data, deployer, onDone, onCancel }: { data: Connections; deployer: boolean; onDone: (name: string) => void; onCancel: () => void }) {
  const split = data.split;
  const references = deployer || !split;
  const [f, setF] = useState({
    url: "ldaps://",
    pin: null as string | null,
    bindDn: "",
    password: "",
    driverSet: "",
    typeDn: false,
    name: "",
    tier: "dev",
    onlyMe: split && !deployer,
    requires: "",
    sshHost: "",
    sshUser: "",
    eventsUrl: "",
    eventsUser: "",
    eventsTable: "",
    eventsTree: "",
    eventsPseudonymise: false,
  });
  const [store, setStore] = useState<Store>({ kind: data.keychain && references ? "keychain" : "file", ref: "" });
  const [more, setMore] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string; check?: SignInCheck } | null>(null);
  const [sets, setSets] = useState<{ dn: string; name: string | null; servers: string[] }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fail, setFail] = useState<string | null>(null);
  const urlOk = /^ldaps?:\/\/[^/]+/i.test(f.url);
  const set = (patch: Partial<typeof f>) => (setF({ ...f, ...patch }), setErrors({}));

  const runTest = () => {
    const e: Record<string, string> = {};
    if (!urlOk) {
      e.url = "Enter the vault's address, like ldaps://vault.example.com:636";
    }
    if (!f.bindDn.trim()) {
      e.bindDn = "Enter the account DN";
    }
    if (!isRef(store) && !f.password) {
      e.password = "Enter the password";
    }
    if (isRef(store)) {
      e.password = "A secret-manager password is tested once the vault is saved; type the password to test it now";
    }
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    setBusy("Signing in…");
    setTest(null);
    setSets(null);
    const req = { url: f.url, bindDn: f.bindDn, password: f.password, certSha256: f.pin };
    api.connections
      .test(req)
      .then((r) => {
        setTest(r);
        if (r.ok) {
          setBusy("Looking up the driver sets…");
          return api.connections.driverSets(req).then((d) => {
            const found = d.driverSets ?? [];
            setSets(found);
            if (found.length > 0 && !f.driverSet) {
              setF((cur) => ({ ...cur, driverSet: found[0]!.dn }));
            }
          });
        }
        return undefined;
      })
      .catch((err: Error) => setTest({ ok: false, message: err.message }))
      .finally(() => setBusy(null));
  };

  const save = () => {
    const e: Record<string, string> = {};
    if (!urlOk) {
      e.url = "Enter the vault's address";
    }
    if (!f.bindDn.trim()) {
      e.bindDn = "Enter the account DN";
    }
    if (!isRef(store) && !f.password) {
      e.password = "Enter the password";
    }
    if (isRef(store) && !store.ref) {
      e.password = "Choose where the password is read from";
    }
    if (!f.driverSet.trim()) {
      e.driverSet = test?.ok ? "Choose the driver set" : "Test your sign-in first, then choose the driver set";
    }
    if (!NAME.test(f.name)) {
      e.name = "A name is letters, digits, '.', '_' and '-'";
    } else if (data.environments.some((x) => x.name === f.name)) {
      e.name = `There is already an environment called ${f.name}`;
    }
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    const definition: Record<string, unknown> = {
      name: f.name,
      url: f.url,
      driverSet: f.driverSet,
      tier: f.tier,
      certSha256: f.pin ?? "",
      requires: f.requires,
      sshHost: f.sshHost,
      sshUser: f.sshUser,
      eventsUrl: f.eventsUrl,
      eventsUser: f.eventsUser,
      eventsTable: f.eventsTable,
      eventsTree: f.eventsTree,
      eventsPseudonymise: f.eventsPseudonymise ? "true" : "",
    };
    const mine: Record<string, unknown> = { name: f.name, bindDn: f.bindDn, trustAll: false, passwordStore: storeArg(store), ...(isRef(store) ? {} : { password: f.password }) };
    setBusy("Saving…");
    setFail(null);
    const go = !split
      ? api.connections.save({ ...definition, ...mine })
      : f.onlyMe
        ? api.connections.saveMine({ ...definition, ...mine })
        : api.connections.save(definition).then(() => api.connections.saveMine(mine));
    go.then(() => onDone(f.name))
      .catch((err: Error) => setFail(err.message))
      .finally(() => setBusy(null));
  };

  const err = (k: string) => (errors[k] ? <span className="err-text small">{errors[k]}</span> : null);
  return (
    <section className="block connform" data-testid="conn-add">
      <h3>Add a vault</h3>

      <h4>1. Where it is</h4>
      <div className="attrs">
        <label className="field wide">
          <em>Address</em>
          <input value={f.url} onChange={(e) => set({ url: e.target.value, pin: null })} placeholder="ldaps://vault.example.com:636" spellCheck={false} data-testid="conn-url" />
          {err("url")}
        </label>
      </div>
      {urlOk && <CertificateBlock url={f.url} pin={f.pin} trustAll={false} canPin={deployer || f.onlyMe || !split} onPin={(sha) => set({ pin: sha })} />}

      <h4>2. How you sign in</h4>
      <div className="attrs">
        <label className="field wide">
          <em>Account DN</em>
          <input value={f.bindDn} onChange={(e) => set({ bindDn: e.target.value })} placeholder="cn=admin,ou=sa,o=system" spellCheck={false} data-testid="conn-binddn" />
          {err("bindDn")}
        </label>
        <PasswordField value={f.password} onChange={(v) => set({ password: v })} store={store} onStore={setStore} references={references} keychain={data.keychain} helpers={data.helpers} error={errors.password} />
      </div>
      <div className="addrow">
        <button onClick={runTest} disabled={busy !== null} data-testid="conn-test">
          Test sign-in
        </button>
        {busy && <span className="muted">{busy}</span>}
      </div>
      <CheckLine result={test} />

      <h4>3. Which driver set</h4>
      {sets && sets.length > 0 && !f.typeDn ? (
        <div data-testid="conn-driversets">
          {sets.map((s) => (
            <label key={s.dn} className="checkchip">
              <input type="radio" name="driverset" checked={f.driverSet === s.dn} onChange={() => set({ driverSet: s.dn })} /> <code>{s.dn}</code>{" "}
              <span className="muted small">{s.servers.length > 0 ? `${s.servers.length} server${s.servers.length === 1 ? "" : "s"}` : ""}</span>
            </label>
          ))}
          <button className="link small" onClick={() => set({ typeDn: true })}>
            Type a DN instead
          </button>
        </div>
      ) : f.typeDn || (sets && sets.length === 0) ? (
        <label className="field wide">
          <em>Driver set DN</em>
          <input value={f.driverSet} onChange={(e) => set({ driverSet: e.target.value })} placeholder="cn=driverset1,o=system" spellCheck={false} data-testid="conn-driverset" />
          {sets && sets.length === 0 && <span className="muted small">The account sees no driver set: type its DN, or sign in with an account that can read it.</span>}
        </label>
      ) : (
        <p className="muted small">
          Test your sign-in first: the vault's driver sets are listed here to choose from.{" "}
          <button className="link" onClick={() => set({ typeDn: true })} data-testid="conn-type-dn">
            Type a DN instead
          </button>
        </p>
      )}
      {err("driverSet")}

      <h4>4. Name it</h4>
      <div className="attrs">
        <label className="field">
          <em>Name</em>
          <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="PROD" spellCheck={false} data-testid="conn-name" />
          {err("name")}
        </label>
        <label className="field">
          <em>Kind</em>
          <select value={f.tier} onChange={(e) => set({ tier: e.target.value })} data-testid="conn-kind">
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {split && deployer && (
          <label className="checkchip">
            <input type="checkbox" checked={f.onlyMe} onChange={(e) => set({ onlyMe: e.target.checked })} /> only for me (kept in your own file, not the project's)
          </label>
        )}
      </div>

      <h4 className="clickable" onClick={() => setMore(!more)} data-testid="conn-more">
        {more ? "▾" : "▸"} More settings <span className="muted small">optional: deploy order, trace over SSH, event store</span>
      </h4>
      {more && <MoreSettings f={f} onChange={(p) => set(p)} />}

      <div className="addrow">
        <button className="primary" onClick={save} disabled={busy !== null} data-testid="conn-save">
          Save vault
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
      {fail && <div className="banner error">{fail}</div>}
    </section>
  );
}

type MoreFields = { requires: string; sshHost: string; sshUser: string; eventsUrl: string; eventsUser: string; eventsTable: string; eventsTree: string; eventsPseudonymise: boolean };

function MoreSettings({ f, onChange, others }: { f: MoreFields; onChange: (p: Partial<MoreFields>) => void; others?: string[] }) {
  return (
    <div data-testid="conn-more-settings">
      <div className="attrs">
        <label className="field">
          <em>Deploy order: deploy to … first</em>
          <input list="conn-envs" value={f.requires} onChange={(e) => onChange({ requires: e.target.value })} placeholder="QA" spellCheck={false} title="A production deploy is refused until the same commit deployed green here" />
          {others && (
            <datalist id="conn-envs">
              {others.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          )}
        </label>
        <label className="field">
          <em>Trace over SSH: host</em>
          <input value={f.sshHost} onChange={(e) => onChange({ sshHost: e.target.value })} spellCheck={false} />
        </label>
        <label className="field">
          <em>Trace over SSH: user</em>
          <input value={f.sshUser} onChange={(e) => onChange({ sshUser: e.target.value })} spellCheck={false} />
        </label>
      </div>
      <div className="attrs">
        <label className="field wide">
          <em>Event store: JDBC URL or host:port/db</em>
          <input value={f.eventsUrl} onChange={(e) => onChange({ eventsUrl: e.target.value })} placeholder="db.example:5432/idmEvent" spellCheck={false} />
        </label>
        <label className="field">
          <em>Reader account</em>
          <input value={f.eventsUser} onChange={(e) => onChange({ eventsUser: e.target.value })} placeholder="eventlogger_reader" spellCheck={false} />
        </label>
        <label className="field">
          <em>Table</em>
          <input value={f.eventsTable} onChange={(e) => onChange({ eventsTable: e.target.value })} placeholder="public.dxmlevent" spellCheck={false} />
        </label>
        <label className="field">
          <em>Tree name in the store</em>
          <input value={f.eventsTree} onChange={(e) => onChange({ eventsTree: e.target.value })} placeholder="from the vault" spellCheck={false} />
        </label>
        <label className="checkchip">
          <input type="checkbox" checked={f.eventsPseudonymise} onChange={(e) => onChange({ eventsPseudonymise: e.target.checked })} /> pseudonymise people in what leaves the server
        </label>
      </div>
    </div>
  );
}

// ---- one environment ----

function EditVault({
  env,
  data,
  deployer,
  check,
  focus,
  onSaved,
  onClose,
  onRemoved,
}: {
  env: ConnectionEnv;
  data: Connections;
  deployer: boolean;
  check: SignInCheck | "checking" | undefined;
  focus: "password" | "vault" | null;
  onSaved: () => void;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const split = data.split;
  const canDefine = !split || (deployer && !!env.defined) || !!env.own;
  const vaultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus === "vault") {
      vaultRef.current?.scrollIntoView({ block: "start" });
    }
  }, [focus]);
  const s = status(env, split, check);
  return (
    <section className="block connform" data-testid="conn-edit">
      <div className="addrow tight">
        <h3 style={{ margin: 0 }}>
          {env.name} <span className={env.tier === "prd" ? "pill err" : "pill"}>{kindLabel(env.tier)}</span> <span className={pillClass(s.tone)}>{s.label}</span>
        </h3>
        <span className="spacer" />
        <button onClick={onClose}>Close</button>
      </div>
      <SignInSection env={env} data={data} deployer={deployer} check={check} focusPassword={focus === "password"} onSaved={onSaved} />
      <div ref={vaultRef}>{canDefine && <VaultSection env={env} data={data} deployer={deployer} onSaved={onSaved} />}</div>
      {canDefine && <ServersSection env={env} data={data} onSaved={onSaved} />}
      {canDefine && (deployer || !split) && <SecretsPanel key={"s" + env.name} env={env.name} keychain={data.keychain} helpers={data.helpers} />}
      {canDefine && <MoreSection env={env} data={data} onSaved={onSaved} />}
      <RemoveSection env={env} split={split} canDefine={canDefine} onRemoved={onRemoved} />
      <p className="muted small">
        Files: {split ? <>the vault in <code>{data.definitions}</code>, your sign-in in <code>{data.file}</code></> : <code>{data.file}</code>}.
      </p>
    </section>
  );
}

function SignInSection({ env, data, deployer, check, focusPassword, onSaved }: { env: ConnectionEnv; data: Connections; deployer: boolean; check: SignInCheck | "checking" | undefined; focusPassword: boolean; onSaved: () => void }) {
  const split = data.split;
  const references = deployer || !split;
  const [bindDn, setBindDn] = useState(env.bindDn ?? "");
  const [password, setPassword] = useState("");
  const [store, setStore] = useState<Store>(() => {
    const k = env.password;
    if (k === "env" || k === "command") {
      return { kind: k === "command" ? "manager" : k, ref: "" };
    }
    return { kind: data.keychain && references ? "keychain" : "file", ref: "" };
  });
  const [result, setResult] = useState<{ ok: boolean; message: string; check?: SignInCheck } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fromReference = env.password === "env" || env.password === "command";
  const c = check && check !== "checking" ? check : null;

  const save = (tested: boolean) => {
    setErrorMsg(null);
    if (!bindDn.trim()) {
      setErrorMsg("Enter the account DN");
      return;
    }
    const newPassword = !isRef(store) && password.length > 0;
    if (!newPassword && !(isRef(store) && store.ref) && !env.password) {
      setErrorMsg("Enter the password");
      return;
    }
    const req: Record<string, unknown> = { name: env.name, bindDn, ...(newPassword || (isRef(store) && store.ref) ? { passwordStore: storeArg(store) } : {}), ...(newPassword ? { password } : {}) };
    const write = () => (split ? api.connections.saveMine(req) : api.connections.save(req));
    if (tested && newPassword) {
      // the new password replaces the stored one only after a sign-in with it works
      setBusy("Signing in with the new password…");
      api.connections
        .test({ url: env.url, bindDn, password, env: env.name, trustAll: env.trustAll === "true" })
        .then((r) => {
          setResult(r);
          if (!r.ok) {
            return undefined;
          }
          setBusy("Saving…");
          return write().then(() => (setPassword(""), onSaved()));
        })
        .catch((e: Error) => setErrorMsg(e.message))
        .finally(() => setBusy(null));
      return;
    }
    setBusy("Saving…");
    write()
      .then(() => (setPassword(""), setResult(null), onSaved()))
      .catch((e: Error) => setErrorMsg(e.message))
      .finally(() => setBusy(null));
  };

  return (
    <div data-testid="conn-signin">
      <h4>Your sign-in</h4>
      {c && c.state !== "ok" && (
        <div className={c.state === "rejected" ? "banner error" : "banner warn"} data-testid="conn-signin-problem">
          {c.state === "rejected" ? (fromReference ? `The password read from ${env.password === "env" ? "an environment variable" : "a secret manager or command"} was rejected${c.reason ? ` (${c.reason})` : ""}. Update it there, then check again.` : `The vault rejected your password${c.reason ? ` (${c.reason})` : ""}. Enter the new one.`) : c.message}
        </div>
      )}
      {c && c.state === "ok" && c.graceRemaining != null && <div className="banner error">Your password has expired: {c.graceRemaining} grace login(s) left. Change it in the vault, then enter it here.</div>}
      {c && c.state === "ok" && c.graceRemaining == null && c.daysLeft != null && c.daysLeft <= 14 && <div className="banner warn">Your password expires in {Math.max(0, c.daysLeft)} day(s).</div>}
      <div className="attrs">
        <label className="field wide">
          <em>Account DN</em>
          <input value={bindDn} onChange={(e) => setBindDn(e.target.value)} placeholder="cn=admin,ou=sa,o=system" spellCheck={false} data-testid="conn-binddn" />
        </label>
        <PasswordField value={password} onChange={setPassword} store={store} onStore={setStore} references={references} keychain={data.keychain} helpers={data.helpers} autoFocus={focusPassword} configured={env.password} />
      </div>
      <div className="addrow">
        {fromReference && isRef(store) && !store.ref ? (
          <button onClick={() => onSaved()} data-testid="conn-check-again">
            Check again
          </button>
        ) : (
          <button className="primary" onClick={() => save(true)} disabled={busy !== null} data-testid="conn-test-save">
            {password ? "Test and save" : "Save"}
          </button>
        )}
        {password && (
          <button className="link" onClick={() => save(false)} disabled={busy !== null} title="For a vault that can't be reached right now">
            Save without testing
          </button>
        )}
        {busy && <span className="muted">{busy}</span>}
      </div>
      <CheckLine result={result} />
      {errorMsg && <div className="banner error">{errorMsg}</div>}
    </div>
  );
}

function VaultSection({ env, data, deployer, onSaved }: { env: ConnectionEnv; data: Connections; deployer: boolean; onSaved: () => void }) {
  const split = data.split;
  const [url, setUrl] = useState(env.url ?? "");
  const [pin, setPin] = useState<string | null>(env.certSha256 ?? null);
  const [driverSet, setDriverSet] = useState(env.driverSet ?? "");
  const [tier, setTier] = useState(env.tier ?? "dev");
  const [sets, setSets] = useState<{ dn: string; servers: string[] }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = url !== (env.url ?? "") || pin !== (env.certSha256 ?? null) || driverSet !== (env.driverSet ?? "") || tier !== (env.tier ?? "dev");

  const write = (patch: Record<string, unknown>) => {
    const req = { name: env.name, ...patch };
    return !split ? api.connections.save(req) : env.own ? api.connections.saveMine(req) : api.connections.save(req);
  };
  const save = (extra: Record<string, unknown> = {}) => {
    setBusy("Saving…");
    setNote(null);
    write({ url, certSha256: pin ?? "", driverSet, tier, ...extra })
      .then(() => {
        // a pinned vault no longer needs "accept any certificate" in the person's sign-in
        if (pin && env.trustAll === "true") {
          return (split ? api.connections.saveMine({ name: env.name, trustAll: false }) : api.connections.save({ name: env.name, trustAll: false })).then(() => undefined);
        }
        return undefined;
      })
      .then(() => (setNote({ ok: true, text: "Saved." }), onSaved()))
      .catch((e: Error) => setNote({ ok: false, text: e.message }))
      .finally(() => setBusy(null));
  };
  const lookUp = () => {
    setBusy("Looking up the driver sets…");
    api.connections
      .driverSets({ url, bindDn: env.bindDn, env: env.name, certSha256: pin, trustAll: env.trustAll === "true" })
      .then((r) => (r.ok ? setSets(r.driverSets ?? []) : setNote({ ok: false, text: r.message })))
      .catch((e: Error) => setNote({ ok: false, text: e.message }))
      .finally(() => setBusy(null));
  };
  return (
    <div data-testid="conn-vault">
      <h4>The vault</h4>
      <div className="attrs">
        <label className="field wide">
          <em>Address</em>
          <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} data-testid="conn-vault-url" />
        </label>
      </div>
      <CertificateBlock url={url} pin={pin} trustAll={env.trustAll === "true"} canPin={deployer || !split || !!env.own} onPin={(sha) => setPin(sha)} />
      <div className="attrs">
        <label className="field wide">
          <em>Driver set</em>
          <span className="withbtn">
            {sets && sets.length > 0 ? (
              <select value={driverSet} onChange={(e) => setDriverSet(e.target.value)}>
                {!sets.some((s) => s.dn === driverSet) && <option value={driverSet}>{driverSet}</option>}
                {sets.map((s) => (
                  <option key={s.dn} value={s.dn}>
                    {s.dn} {s.servers.length > 0 ? `(${s.servers.length} server${s.servers.length === 1 ? "" : "s"})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input value={driverSet} onChange={(e) => setDriverSet(e.target.value)} spellCheck={false} />
            )}
            <button type="button" onClick={lookUp} disabled={busy !== null} title="Sign in with your sign-in above and list the vault's driver sets">
              Look up
            </button>
          </span>
        </label>
        <label className="field">
          <em>Kind</em>
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="addrow">
        <button className={dirty ? "primary" : ""} onClick={() => save()} disabled={busy !== null || !dirty} data-testid="conn-vault-save">
          {pin !== (env.certSha256 ?? null) ? "Save (trust this certificate)" : "Save"}
        </button>
        {!dirty && <span className="muted small">No changes.</span>}
        {busy && <span className="muted">{busy}</span>}
      </div>
      {note && <p className={note.ok ? "ok-text small" : "err-text small"}>{note.text}</p>}
    </div>
  );
}

/**
 * The driver set's servers (#134): the connection's own server is reached at the environment's address; each other
 * at the address its server object names, which is often internal, unless one is given here (saved as servers=).
 */
function ServersSection({ env, data, onSaved }: { env: ConnectionEnv; data: Connections; onSaved: () => void }) {
  const [rows, setRows] = useState<ServerAddress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [given, setGiven] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = () => {
    setError(null);
    api.connections
      .servers(env.name)
      .then((r) => {
        setRows(r.servers);
        const g: Record<string, string> = {};
        for (const s of r.servers) {
          if (s.configured) {
            g[s.dn] = s.configured;
          }
        }
        setGiven(g);
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, [env.name, env.servers]);
  if (error) {
    return (
      <div>
        <h4>Servers</h4>
        <p className="muted small">Sign in first to see the driver set's servers. ({error})</p>
      </div>
    );
  }
  if (!rows || rows.length < 2) {
    return null;
  }
  const save = () => {
    const value = rows
      .filter((s) => !s.primary && (given[s.dn] ?? "").trim())
      .map((s) => `${s.dn}=${given[s.dn]!.trim()}`)
      .join(";");
    setBusy(true);
    const req = { name: env.name, servers: value };
    (!data.split ? api.connections.save(req) : env.own ? api.connections.saveMine(req) : api.connections.save(req))
      .then(() => (load(), onSaved()))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div data-testid="conn-servers">
      <h4>Servers</h4>
      <p className="muted small">The driver set runs on {rows.length} servers. Each one is reached at its own address for the trace, an import and a deploy; give a reachable one where the address its server object names doesn't work from here.</p>
      <table className="grid">
        <thead>
          <tr>
            <th>Server</th>
            <th>Address</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.dn}>
              <td>
                {s.name}
                {s.primary && <span className="muted small"> (this connection)</span>}
              </td>
              <td>
                {s.primary ? (
                  <code className="small">{s.url}</code>
                ) : (
                  <input className="wide" value={given[s.dn] ?? ""} onChange={(e) => setGiven({ ...given, [s.dn]: e.target.value })} placeholder={s.derived ?? "ldaps://host:636"} spellCheck={false} data-testid={"conn-server-" + s.name} />
                )}
              </td>
              <td>{s.reachable ? <span className="pill ok">reachable</span> : <span className="pill warn" title={s.message ?? ""}>unreachable</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="addrow">
        <button onClick={save} disabled={busy} data-testid="conn-servers-save">
          Save addresses
        </button>
        <button className="link" onClick={load}>
          Check again
        </button>
      </div>
    </div>
  );
}

function MoreSection({ env, data, onSaved }: { env: ConnectionEnv; data: Connections; onSaved: () => void }) {
  const has = !!(env.requires || env.sshHost || env.sshUser || env.eventsUrl);
  const [open, setOpen] = useState(has);
  const [f, setF] = useState<MoreFields>({
    requires: env.requires ?? "",
    sshHost: env.sshHost ?? "",
    sshUser: env.sshUser ?? "",
    eventsUrl: env.eventsUrl ?? "",
    eventsUser: env.eventsUser ?? "",
    eventsTable: env.eventsTable ?? "",
    eventsTree: env.eventsTree ?? "",
    eventsPseudonymise: env.eventsPseudonymise === "true",
  });
  const [evPassword, setEvPassword] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const save = () => {
    const def = { name: env.name, ...f, eventsPseudonymise: f.eventsPseudonymise ? "true" : "" };
    const first = !data.split ? api.connections.save(def) : env.own ? api.connections.saveMine(def) : api.connections.save(def);
    first
      .then(() => (evPassword ? (data.split ? api.connections.saveMine({ name: env.name, eventsPasswordStore: "file", eventsPassword: evPassword }) : api.connections.save({ name: env.name, eventsPasswordStore: "file", eventsPassword: evPassword })) : null))
      .then(() => (setEvPassword(""), setNote({ ok: true, text: "Saved." }), onSaved()))
      .catch((e: Error) => setNote({ ok: false, text: e.message }));
  };
  return (
    <div>
      <h4 className="clickable" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} More settings <span className="muted small">deploy order, trace over SSH, event store</span>
      </h4>
      {open && (
        <>
          <MoreSettings f={f} onChange={(p) => setF({ ...f, ...p })} others={data.environments.map((e) => e.name).filter((n) => n !== env.name)} />
          {(f.eventsUrl || env.eventsUrl) && (
            <div className="attrs">
              <label className="field">
                <em>Event store: your reader password</em>
                <input type="password" value={evPassword} onChange={(e) => setEvPassword(e.target.value)} placeholder={env.eventsPassword ? "set: type to replace" : "password"} autoComplete="new-password" />
              </label>
            </div>
          )}
          <div className="addrow">
            <button onClick={save}>Save</button>
            {note && <span className={note.ok ? "ok-text small" : "err-text small"}>{note.text}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function RemoveSection({ env, split, canDefine, onRemoved }: { env: ConnectionEnv; split: boolean; canDefine: boolean; onRemoved: () => void }) {
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const removeVault = canDefine && (!split || env.defined || env.own);
  // one file: the environment; an environment only you use: your file's entries; a project's: its definition
  const go = () =>
    (split && env.own ? api.connections.removeMine(env.name) : api.connections.remove(env.name)).then(() => onRemoved()).catch((e: Error) => setErr(e.message));
  return (
    <div>
      {!open ? (
        <div className="addrow">
          {split && env.defined && (
            <button onClick={() => void api.connections.removeMine(env.name).then(onRemoved).catch((e: Error) => setErr(e.message))}>Forget my sign-in</button>
          )}
          {removeVault && (
            <button className="danger" onClick={() => setOpen(true)}>
              Remove this vault…
            </button>
          )}
        </div>
      ) : (
        <div className="addrow">
          <span className="small">
            Type <code>{env.name}</code> to remove it{split && env.defined ? " for everyone on the project" : ""}:
          </span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} />
          <button className="danger" disabled={typed !== env.name} onClick={go}>
            Remove {env.name}
          </button>
          <button onClick={() => setOpen(false)}>Keep it</button>
        </div>
      )}
      {err && <div className="banner error">{err}</div>}
    </div>
  );
}

// ---- driver secrets ----

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
        setNote(`${key}: ${r.notes.join("; ") || "saved"}.${value ? " A secret already in the vault reaches it on the next deploy with \"re-set every provided secret\"." : ""}`);
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
    return <p className="muted small">Reading what the drivers need…</p>;
  }
  const needs = [...data.needs].sort((a, b) => (a.configured ? 1 : 0) - (b.configured ? 1 : 0));
  const missing = needs.filter((n) => !n.configured).length;
  return (
    <div data-testid="conn-secrets">
      <h4>Driver secrets</h4>
      <p className="muted small">
        What the drivers need when deployed to {env}. {missing === 0 ? "Everything needed is set." : `${missing} missing.`} New values are stored{" "}
        <select value={store} onChange={(e) => setStore(e.target.value)}>
          {keychain && <option value="keychain">in the macOS Keychain</option>}
          <option value="file">in the secrets file (readable by you only)</option>
        </select>
      </p>
      <table className="grid">
        <thead>
          <tr>
            <th>Driver</th>
            <th>Secret</th>
            <th>Why</th>
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          {needs.map((n) => (
            <tr key={n.key}>
              <td>{n.driver}</td>
              <td>
                <code>{n.kind === "named" ? n.key.slice(n.driver.length + 1) : n.kind}</code>
              </td>
              <td className="muted small">{n.because}</td>
              <td>{n.configured ? <span className="pill ok">set</span> : <span className="pill err">missing</span>}</td>
              <td className="right">
                <input type="password" value={values[n.key] ?? ""} onChange={(e) => setValues({ ...values, [n.key]: e.target.value })} autoComplete="new-password" placeholder={n.configured ? "new value" : "value"} />{" "}
                <button disabled={!values[n.key] || busy !== null} onClick={() => set(n.key, values[n.key]!, store)}>
                  {n.configured ? "Replace" : "Set"}
                </button>{" "}
                {n.configured && (
                  <button disabled={busy !== null} onClick={() => check(n.key)} title="Read it back and say whether a value came">
                    Check
                  </button>
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
              <td className="muted small">in the file, not needed by these drivers</td>
              <td>
                <span className="pill">{o.configured}</span>
              </td>
              <td className="right">
                <button disabled={busy !== null} onClick={() => set(o.key, "", "remove")}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.needs.length === 0 && data.others.length === 0 && <p className="muted small">These drivers need no secrets.</p>}
      <div className="addrow">
        <span className="small">Another secret</span>
        <input className="wide" placeholder="AD Driver.named.exchange-service" value={extra.key} onChange={(e) => setExtra({ ...extra, key: e.target.value })} spellCheck={false} />
        <input type="password" placeholder="value" value={extra.value} onChange={(e) => setExtra({ ...extra, value: e.target.value })} autoComplete="new-password" />
        <button disabled={!extra.key || !extra.value || busy !== null} onClick={() => (set(extra.key, extra.value, store), setExtra({ key: "", value: "" }))}>
          Save
        </button>
      </div>
      <details>
        <summary className="small">Read a secret from a secret manager instead</summary>
        <div className="addrow tight">
          <input list="secretkeys" className="wide" placeholder="AD Driver.shim-auth-password" value={ref.key} onChange={(e) => setRef({ ...ref, key: e.target.value })} spellCheck={false} data-testid="secret-ref-key" />
          <datalist id="secretkeys">
            {data.needs.map((n) => (
              <option key={n.key} value={n.key} />
            ))}
          </datalist>
        </div>
        <ManagerPicker helpers={helpers} onCommand={(c) => setRef((cur) => ({ ...cur, command: c }))} />
        <button disabled={!ref.key || !ref.command || busy !== null} onClick={() => (set(ref.key, "", `command:${ref.command}`), setRef({ key: "", command: ref.command }))} data-testid="secret-ref-save">
          Save the reference
        </button>
      </details>
      {note && <p className="ok-text small">{note}</p>}
    </div>
  );
}
