import type { CacheView, CaseFiles, CasePlan, EventDetail, EventRow, EventsDescribe } from "./types";
import type { TraceRec } from "./trace/model";
import type { AppSchema, Artifact, AuditEntry, BuildResult, ConfigView, Connections, DeployResult, EnvSecrets, FetchResult, FormData as FormDoc, GitDiff, GitStatus, ImportResult, LifecycleResult, OpCall, OpResult, OpSpec, Outline, OverridesData, PackagePrompts, PackagesData, PrdData, RoleCatalog, SchemaActionResult, SchemaClass, SchemaData, Session, SetupResult, SimCaseFiles, SimCases, SimDetail, SimRun, SiteListing, TreeFile, UpdateSites, Validation, VaultDiffResult, VaultEnvironments, VaultStatus, WorkspacesInfo } from "./types";
import type { FishboneModel } from "./fishbone/types";

/**
 * The session token arrives once in the URL fragment the server prints (`/#token=…`). It is
 * moved into sessionStorage and removed from the address bar, then sent as a header on every
 * request; the event stream takes it as a query parameter because EventSource has no headers.
 */
const KEY = "idmweb.token";

export function takeToken(): string | null {
  const m = /[#&]token=([0-9a-f]+)/.exec(window.location.hash);
  if (m && m[1]) {
    sessionStorage.setItem(KEY, m[1]);
    // the rest of the hash stays: a pop-out window opens at its view with the token appended
    const rest = window.location.hash.replace(/[#&]token=[0-9a-f]+/, "").replace(/^&/, "#");
    history.replaceState(null, "", window.location.pathname + window.location.search + (rest.length > 1 ? rest : ""));
  }
  return sessionStorage.getItem(KEY);
}

function token(): string {
  return sessionStorage.getItem(KEY) ?? "";
}

/** The token to append to a link that opens a new window (sessionStorage is per window); empty in hosted mode, where the cookie carries the session. */
export function tokenForLink(): string {
  return token();
}

/** Hosted mode: the session's CSRF token, learned from /api/session and sent on every write. */
let csrf = "";
export function setCsrf(value: string): void {
  csrf = value;
}

/** An API error: the server's message, and the HTTP status (409 = the tree moved under a write). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly noWorkspace = false,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "X-IDMWeb-Token": token(), ...(csrf ? { "X-IDMWeb-CSRF": csrf } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // not JSON: the status says what happened
  }
  if (!res.ok) {
    const message = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `HTTP ${res.status}`;
    if (res.status === 401 && data && typeof data === "object" && "login" in data) {
      // the hash (the view) does not survive the sign-in round trip on its own: keep it for the return
      try {
        sessionStorage.setItem("idmweb.return", window.location.hash);
      } catch {
        // no storage: the page opens at home
      }
      // hosted mode without a session: go and sign in, then come back here
      window.location.assign(`${String((data as { login: string }).login)}?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiError(message, res.status, !!data && typeof data === "object" && "noWorkspace" in data);
  }
  return data as T;
}

const q = encodeURIComponent;

export const api = {
  session: () => call<Session>("GET", "/api/session"),
  outline: () => call<Outline>("GET", "/api/outline"),
  artifact: (path: string) => call<Artifact>("GET", `/api/artifact?path=${q(path)}`),
  file: (file: string) => call<TreeFile>("GET", `/api/file?file=${q(file)}`),
  fishbone: (driver: string) => call<FishboneModel & { revision: string }>("GET", `/api/fishbone?driver=${q(driver)}`),
  validation: () => call<Validation>("GET", "/api/validate"),
  catalog: () => call<{ operations: OpSpec[] }>("GET", "/api/catalog"),
  config: (driver: string | null) => call<ConfigView>("GET", driver ? `/api/config?driver=${q(driver)}` : "/api/config"),
  overrides: () => call<OverridesData>("GET", "/api/overrides"),
  prd: (driver: string, name: string) => call<PrdData>("GET", `/api/prd?driver=${q(driver)}&name=${q(name)}`),
  form: (driver: string, name: string) => call<FormDoc>("GET", `/api/form?driver=${q(driver)}&name=${q(name)}`),
  roles: () => call<RoleCatalog>("GET", "/api/roles"),
  packages: () => call<PackagesData>("GET", "/api/packages"),
  workspaces: (project?: string) => call<WorkspacesInfo>("GET", project ? `/api/workspaces?project=${q(project)}` : "/api/workspaces"),
  setup: {
    state: () => call<{ needed: boolean; dataDir: string; repository: string | null; inPlace: string | null }>("GET", "/api/setup"),
    driverSets: (env: string) => call<{ environment: string; configured: string | null; driverSets: { dn: string; name: string; drivers: number; default: boolean }[] }>("GET", `/api/setup/driversets?env=${q(env)}`),
    vault: (project: string, env: string, driverSet: string) => call<SetupResult>("POST", "/api/setup/vault", { project, env, driverSet }),
    project: (project: string, path: string) => call<SetupResult>("POST", "/api/setup/project", { project, path }),
    existing: (project: string, path: string) => call<SetupResult>("POST", "/api/setup/existing", { project, path }),
    directory: (project: string, path: string) => call<SetupResult>("POST", "/api/setup/directory", { project, path }),
    clone: (project: string, url: string, token: string, base: string) => call<SetupResult>("POST", "/api/setup/clone", { project, url, token, base }),
    remove: (project: string) => call<{ removed: string }>("POST", "/api/setup/remove", { project }),
    /** A Designer project (zip) or export (xml), streamed as the request body. */
    upload: async (project: string, kind: "project" | "export", file: File): Promise<SetupResult> => {
      const res = await fetch(`/api/setup/upload?kind=${kind}&project=${encodeURIComponent(project)}&name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "X-IDMWeb-Token": token(), ...(csrf ? { "X-IDMWeb-CSRF": csrf } : {}), "Content-Type": "application/octet-stream" },
        body: file,
      });
      const data = (await res.json()) as SetupResult & { error?: string };
      if (!res.ok) {
        throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status);
      }
      return data;
    },
  },
  openWorkspace: (branch: string, project?: string) => call<{ workspace: string; project: string | null; branch: string }>("POST", "/api/workspaces/open", { branch, project }),
  git: {
    status: () => call<GitStatus>("GET", "/api/git/status"),
    diff: (against: "head" | "base" | "upstream") => call<GitDiff>("GET", `/api/git/diff?against=${against}`),
    commit: (message: string, push: boolean) => call<{ committed: boolean; hash?: string; pushed?: boolean; message?: string }>("POST", "/api/git/commit", { message, push }),
    update: (base?: string) => call<{ merged: boolean; message: string; conflicts?: string[] }>("POST", "/api/git/update", base ? { base } : {}),
  },
  connections: {
    list: () => call<Connections>("GET", "/api/credentials"),
    /** The parameters as typed; a password given here is used once and not kept. */
    test: (req: Record<string, unknown>) => call<{ ok: boolean; message: string; driverSetFound?: boolean }>("POST", "/api/credentials/test", req),
    driverSets: (req: Record<string, unknown>) => call<{ ok: boolean; message: string; driverSets?: { dn: string; name: string | null; servers: string[] }[] }>("POST", "/api/credentials/driversets", req),
    save: (req: Record<string, unknown>) => call<{ name: string; file: string; notes: string[] }>("POST", "/api/credentials/environment", req),
    remove: (name: string) => call<{ name: string; removed: number }>("POST", "/api/credentials/environment/remove", { name }),
    /** Does a reference yield a value? A configured one (env, optional key) or a command not yet saved. */
    resolve: (req: { env?: string; key?: string; command?: string }) => call<{ ok: boolean; message: string }>("POST", "/api/credentials/resolve", req),
    secrets: (env: string) => call<EnvSecrets>("GET", `/api/credentials/secrets?env=${q(env)}`),
    setSecret: (req: { env: string; key: string; store: string; value?: string }) => call<{ key: string; file: string; notes: string[] }>("POST", "/api/credentials/secret", req),
  },
  buildPackage: (req: Record<string, unknown>) => call<BuildResult>("POST", "/api/packages/build", req),
  packageSites: () => call<UpdateSites>("GET", "/api/packages/sites"),
  schema: () => call<SchemaData>("GET", "/api/schema"),
  schemaClass: (name: string) => call<SchemaClass>("GET", `/api/schema/class?name=${q(name)}`),
  appSchema: (driver: string) => call<AppSchema>("GET", `/api/schema/app?driver=${q(driver)}`),
  importPackage: async (file: File): Promise<ImportResult> => {
    const res = await fetch(`/api/packages/import?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "X-IDMWeb-Token": token(), ...(csrf ? { "X-IDMWeb-CSRF": csrf } : {}), "Content-Type": "application/octet-stream" },
      body: file,
    });
    const data = (await res.json()) as ImportResult & { error?: string };
    if (!res.ok) {
      throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status, false);
    }
    return data;
  },
  audit: (p: { since?: string; user?: string; project?: string; event?: string; limit?: number }) =>
    call<{ entries: AuditEntry[] }>("GET", "/api/audit?" + Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${q(String(v))}`).join("&")),
  packagePrompts: (packages: string, driver?: string) => call<PackagePrompts>("GET", `/api/packages/prompts?packages=${q(packages)}${driver ? `&driver=${q(driver)}` : ""}`),
  packageSite: (site: string) => call<SiteListing>("GET", `/api/packages/site?site=${q(site)}`),
  fetchPackages: (req: { site: string; packages: string[]; allVersions?: boolean; dryRun?: boolean }) => call<FetchResult>("POST", "/api/packages/fetch", req),
  events: {
    describe: (env: string) => call<EventsDescribe>("GET", `/api/eventlog/describe?env=${q(env)}`),
    list: (env: string, query: Record<string, string>) =>
      call<{ environment: string; count: number; limit: number; events: EventRow[] }>("GET", `/api/eventlog?env=${q(env)}` + Object.entries(query).map(([k, v]) => `&${k}=${q(v)}`).join("")),
    get: (env: string, id: number) => call<EventDetail>("GET", `/api/eventlog/event?env=${q(env)}&id=${id}`),
    saveCase: (env: string, req: { id: number; name?: string; driver?: string; channel?: string; replace?: boolean; dryRun?: boolean }) => call<CasePlan>("POST", "/api/eventlog/case", { env, ...req }),
  },
  sim: {
    cases: () => call<SimCases>("GET", "/api/sim/cases"),
    files: (name: string) => call<SimCaseFiles>("GET", `/api/sim/case?name=${q(name)}`),
    /** The whole corpus as the gate runs it. */
    run: (env: string | null) => call<SimRun>("POST", "/api/sim/run", { env }),
    /** One case stage by stage; `input` replaces the case's input for this run only; `against` ("" = base values) compares with another stage. */
    detail: (name: string, opts: { env?: string | null; input?: string; against?: string }) => call<SimDetail>("POST", "/api/sim/detail", { name, ...opts }),
    save: (name: string, input: string, driver?: string, channel?: string) => call<{ name: string; created: boolean }>("POST", "/api/sim/save", { name, input, driver, channel }),
    record: (name: string) => call<{ name: string; wrote: string[] }>("POST", "/api/sim/record", { name }),
  },
  vault: {
    environments: () => call<VaultEnvironments>("GET", "/api/vault/environments"),
    refreshSchema: (env: string) => call<SchemaActionResult>("POST", "/api/vault/schema", { env }),
    refreshAppSchema: (env: string, driver: string) => call<SchemaActionResult>("POST", "/api/vault/app-schema", { env, driver }),
    deploySchema: (env: string, confirm?: string) => call<SchemaActionResult>("POST", "/api/vault/deploy-schema", { env, confirm: confirm ?? "" }),
    diff: (env: string, drivers: string[]) => call<VaultDiffResult>("GET", `/api/vault/diff?env=${q(env)}${drivers.map((d) => `&driver=${q(d)}`).join("")}`),
    plan: (env: string, drivers: string[], restart: boolean) => call<DeployResult>("POST", "/api/vault/plan", { env, drivers, restart }),
    /** `confirm` is the environment's name, typed by the person: the server refuses anything else. */
    deploy: (env: string, drivers: string[], restart: boolean, confirm: string) => call<DeployResult>("POST", "/api/vault/deploy", { env, drivers, restart, confirm }),
    status: (env: string) => call<VaultStatus>("GET", `/api/vault/status?env=${q(env)}`),
    servers: (env: string) => call<{ environment: string; primary: string | null; servers: { dn: string; name: string; url: string | null; primary: boolean }[] }>("GET", `/api/vault/servers?env=${q(env)}`),
    driver: (env: string, driver: string, action: string, confirm: string) => call<LifecycleResult>("POST", "/api/vault/driver", { env, driver, action, confirm }),
    cache: (env: string, driver: string, count = 200) => call<CacheView>("GET", `/api/vault/cache?env=${q(env)}&driver=${q(driver)}&count=${count}`),
    cacheCase: (env: string, req: { driver: string; name?: string; channel?: string; replace?: boolean; dryRun?: boolean }) => call<CaseFiles>("POST", "/api/vault/cache-case", { env, ...req }),
    cacheClear: (env: string, driver: string, confirm: string) => call<LifecycleResult>("POST", "/api/vault/cache-clear", { env, driver, confirm }),
    traceLevel: (env: string, driver: string, level: number, confirm: string, server?: string) => call<LifecycleResult>("POST", "/api/vault/trace-level", { env, driver, level, confirm, ...(server ? { server } : {}) }),
  },
  /** Several operations as one change: validated once, written together or not at all. */
  batch: (ops: OpCall[], dryRun: boolean, revision: string) =>
    call<OpResult>("POST", "/api/batch", { ops: ops.map((o) => ({ name: o.name, args: o.args, files: o.files ?? {} })), dryRun, revision }),
  run: (
    name: string,
    req: { args: Record<string, string>; files?: Record<string, string>; dryRun: boolean; revision: string; force?: boolean },
  ) => call<OpResult>("POST", `/api/op/${q(name)}`, req),
};

/** Follow the tree: `onRevision` fires with each new revision, `onState` with the stream's health. */
export function followTree(onRevision: (revision: string) => void, onState: (live: boolean) => void): () => void {
  const es = new EventSource(`/api/events?token=${q(token())}`);
  es.addEventListener("tree", (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent<string>).data) as { revision: string };
      onRevision(data.revision);
    } catch {
      // a malformed event is skipped
    }
  });
  es.onopen = () => onState(true);
  es.onerror = () => onState(false);
  return () => es.close();
}

/** Follow a driver's trace: `onLine` per line, `onState` with open / closed / the failure's message. */
/** The live trace stream: parsed records (see web/src/trace/model.ts), or `{error}` for a server whose stream failed. `driver` null = every driver. */
export function followTrace(env: string, driver: string | null, engine: boolean, onRecord: (r: TraceRec | { error: string }) => void, onState: (state: "open" | "closed" | { failed: string }) => void, server?: string): () => void {
  const es = new EventSource(`/api/vault/trace?env=${q(env)}${driver ? `&driver=${q(driver)}` : ""}${engine ? "&engine=true" : ""}${server ? `&server=${q(server)}` : ""}&token=${q(token())}`);
  es.addEventListener("open", () => onState("open"));
  es.addEventListener("fail", (ev) => {
    let message = "the trace stream failed";
    try {
      message = String(JSON.parse((ev as MessageEvent<string>).data));
    } catch {
      // keep the default
    }
    es.close();
    onState({ failed: message });
  });
  es.onmessage = (ev) => {
    try {
      onRecord(JSON.parse(ev.data as string) as TraceRec | { error: string });
    } catch {
      // a malformed event is skipped
    }
  };
  es.onerror = () => {
    // the server ended the stream (or the connection dropped): do not let EventSource reconnect on its own
    es.close();
    onState("closed");
  };
  return () => es.close();
}
