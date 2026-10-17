import type { CacheView, CaseFiles, CasePlan, EventDetail, EventRow, EventsDescribe, TraceFileEntry, VaultPolicies, PolicyMembers, AppQueryResult, DriverHealth, LogLevel, DriverRights, DriverSetAdmin, EngineMetrics, WorkOrders, EmailServer, EngineInfo, DriverDetail, TraceShow, TraceTailResult, NamedPasswords, OperateOutcome, PullResult, NewProjectFields, ProjectExportResult, PullRequestInfo, PullRequestCreated, GitTokenHost, MergePreview, MergeResult } from "./types";
import type { TraceRec } from "./trace/model";
import type { AppSchema, Architecture, DevNode, DeployChoices, DriverAssociations, ObjectInspection, PasswordSync, VaultJobs, VaultSnapshot, SchemaDiffResult, ProjectArchive, ProjectArchiveResult, Artifact, AuditEntry, BuildResult, ConfigView, Connections, DeployResult, EnvSecrets, FetchResult, FormData as FormDoc, GitDiff, GitStatus, ImportResult, LifecycleResult, OpCall, OpResult, OpSpec, Outline, OverridesData, PackagePrompts, PackagesData, PrdData, RoleCatalog, SchemaActionResult, SchemaClass, SchemaData, Session, SetupResult, SimCaseFiles, SimCases, SimDetail, SimRun, SiteListing, TreeFile, UpdateSites, Validation, VaultDiffResult, VaultEnvironments, VaultStatus, VaultTask, VaultCertificate, SignInCheck, ServerAddress, ProjectRepository, RepositoryCheck, WorkspacesInfo } from "./types";
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
/** The session header for a fetch of a binary the page makes itself (an icon for an export). */
export function authHeaders(): Record<string, string> {
  return { "X-IDMWeb-Token": token() };
}

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
  if (method !== "GET" && path.startsWith("/api/vault/")) {
    // a vault write appends to the deploy record, which does not move the revision (#128): the commit bar asks git again
    window.dispatchEvent(new Event(GIT_CHANGED));
  }
  return data as T;
}

/** Fired when the workspace's git status may have changed without the tree's revision moving (the deploy record). */
export const GIT_CHANGED = "idmweb:git-changed";

const q = encodeURIComponent;

export const api = {
  session: () => call<Session>("GET", "/api/session"),
  authHeaders,
  outline: () => call<Outline>("GET", "/api/outline"),
  /** The whole driver set as one tree (#32 A2). */
  developer: () => call<{ revision: string; root: DevNode }>("GET", "/api/developer"),
  /** The driver set as applications around the vault (#32). */
  architecture: () => call<Architecture>("GET", "/api/architecture"),
  driverIconUrl: (driver: string, revision: string) => `/api/driver-icon?driver=${q(driver)}&rev=${q(revision)}${tokenForLink() ? `&token=${encodeURIComponent(tokenForLink())}` : ""}`,
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
    /** Bundle the repository, move the project's data aside, forget it (deployers, #76). */
    archive: (project: string) => call<ProjectArchiveResult>("POST", "/api/setup/archive", { project }),
    archives: () => call<{ dir: string; archives: ProjectArchive[] }>("GET", "/api/setup/archives"),
    /** Where a project pushes (docs/connections-ui.md, The project's repository); never a token. */
    repository: (project: string) => call<ProjectRepository>("GET", `/api/setup/repository?project=${q(project)}`),
    /** Can the project move to this remote: reachable, empty (or already this history), what isn't pushed yet. */
    repositoryCheck: (project: string, url: string, token: string) => call<RepositoryCheck>("POST", "/api/setup/repository/check", { project, url, token }),
    repositoryMove: (project: string, url: string, token: string, confirm: string) => call<{ ok: boolean; pushesTo: string; branches: number; tags: number; workspaces: number; kept: string }>("POST", "/api/setup/repository/move", { project, url, token, confirm }),
    repositoryChange: (project: string, url: string, token: string, confirm: string) => call<{ ok: boolean; pushesTo: string; workspaces: number }>("POST", "/api/setup/repository/change", { project, url, token, confirm }),
    archiveFileUrl: (name: string) => `/api/setup/archive/file?name=${q(name)}${tokenForLink() ? `&token=${encodeURIComponent(tokenForLink())}` : ""}`,
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
    /** Commit the deploy record (deploy-log/) alone, the rest of the work left uncommitted (#128). */
    commitRecord: (message: string) => call<{ committed: boolean; hash?: string; message?: string }>("POST", "/api/git/commit", { message, push: false, record: true }),
    /** One uncommitted file back to the last commit, or removed when it is new. */
    discard: (file: string) => call<{ discarded: boolean; message: string }>("POST", "/api/git/discard", { file }),
    update: (base?: string) => call<{ merged: boolean; message: string; conflicts?: string[] }>("POST", "/api/git/update", base ? { base } : {}),
    /** docs/git-workflow.md: what merging this branch into the base would carry. */
    mergePreview: () => call<MergePreview>("GET", "/api/git/merge-into-base"),
    /** Merge this branch into the base on the repository (pushed); a conflict merges nothing. */
    mergeIntoBase: () => call<MergeResult>("POST", "/api/git/merge-into-base", {}),
    /** Merge a captured as-found/<env>/<time> branch (vault.deploy --capture-drift) into this branch. */
    mergeCaptured: (branch: string) => call<{ merged: boolean; message: string; conflicts?: string[] }>("POST", "/api/git/merge-captured", { branch }),
    /** #35: the branch's open request, or whether one can be created through the provider's API. */
    pullRequest: () => call<PullRequestInfo>("GET", "/api/git/pull-request"),
    createPullRequest: (req: { title: string; body: string; draft: boolean }) => call<PullRequestCreated>("POST", "/api/git/pull-request", req),
  },
  connections: {
    list: () => call<Connections>("GET", "/api/credentials"),
    /** The parameters as typed; a password given here is used once and not kept. */
    test: (req: Record<string, unknown>) => call<{ ok: boolean; message: string; driverSetFound?: boolean; check?: SignInCheck }>("POST", "/api/credentials/test", req),
    /** The certificate an ldaps:// address presents, for the page to show and pin. */
    certificate: (url: string) => call<VaultCertificate>("POST", "/api/credentials/certificate", { url }),
    /** One environment's sign-in, as configured; `fresh: false` may answer from the last five minutes. */
    check: (env: string, fresh = true) => call<SignInCheck>("POST", "/api/credentials/check", { env, fresh }),
    /** Your environments whose sign-in needs you: rejected, certificate, unreachable, or expiring within 14 days. */
    problems: () => call<{ problems: SignInCheck[] }>("GET", "/api/credentials/problems"),
    /** The driver set's servers, the address each is reached at, and whether it answers (#134). */
    servers: (env: string) => call<{ env: string; servers: ServerAddress[] }>("GET", `/api/credentials/servers?env=${q(env)}`),
    driverSets: (req: Record<string, unknown>) => call<{ ok: boolean; message: string; driverSets?: { dn: string; name: string | null; servers: string[] }[] }>("POST", "/api/credentials/driversets", req),
    save: (req: Record<string, unknown>) => call<{ name: string; file: string; notes: string[] }>("POST", "/api/credentials/environment", req),
    remove: (name: string) => call<{ name: string; removed: number }>("POST", "/api/credentials/environment/remove", { name }),
    /** Two files: the person's own connection to an environment (any signed-in role). */
    saveMine: (req: Record<string, unknown>) => call<{ name: string; file: string; own: boolean; notes: string[] }>("POST", "/api/credentials/mine", req),
    removeMine: (name: string) => call<{ name: string; removed: number }>("POST", "/api/credentials/mine/remove", { name }),
    /** Does a reference yield a value? A configured one (env, optional key) or a command not yet saved. */
    resolve: (req: { env?: string; key?: string; command?: string }) => call<{ ok: boolean; message: string }>("POST", "/api/credentials/resolve", req),
    secrets: (env: string) => call<EnvSecrets>("GET", `/api/credentials/secrets?env=${q(env)}`),
    setSecret: (req: { env: string; key: string; store: string; value?: string }) => call<{ key: string; file: string; notes: string[] }>("POST", "/api/credentials/secret", req),
    /** #35 P2: the person's own Git provider tokens, by host (never the values). */
    gitTokens: () => call<{ hosts: GitTokenHost[] }>("GET", "/api/credentials/git"),
    saveGitToken: (req: { host: string; store: string; token?: string }) => call<{ host: string; store: string | null; notes: string[] }>("POST", "/api/credentials/git", req),
    removeGitToken: (host: string) => call<{ host: string; removed: boolean }>("POST", "/api/credentials/git/remove", { host }),
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
  /** The round trip back to Designer (#66): the export XML, a project on the host (deployers), a project as a zip. */
  designer: {
    exportUrl: (driver?: string) => `/api/export/designer${driver ? `?driver=${q(driver)}` : ""}${token() ? `${driver ? "&" : "?"}token=${q(token())}` : ""}`,
    project: (body: { mode: "update" | "new"; path: string; dryRun: boolean } & NewProjectFields) => call<ProjectExportResult>("POST", "/api/export/project", body),
    /** mode=update uploads the project zip; mode=new names the project. A dry run is the result; an apply is the zip. */
    projectZip: async (mode: "update" | "new", dryRun: boolean, name: string, fields: NewProjectFields, file: File | null): Promise<ProjectExportResult | { blob: Blob; fileName: string }> => {
      const params = new URLSearchParams({ mode, dryRun: String(dryRun), ...(name ? { name } : {}) });
      for (const [k, v] of Object.entries(fields)) {
        if (v) {
          params.set(k, v);
        }
      }
      const res = await fetch(`/api/export/project-zip?${params.toString()}`, {
        method: "POST",
        headers: { "X-IDMWeb-Token": token(), ...(csrf ? { "X-IDMWeb-CSRF": csrf } : {}), "Content-Type": "application/zip" },
        body: file ?? undefined,
      });
      if (res.ok && (res.headers.get("Content-Type") ?? "").startsWith("application/zip")) {
        const disposition = res.headers.get("Content-Disposition") ?? "";
        const m = /filename="([^"]+)"/.exec(disposition);
        return { blob: await res.blob(), fileName: m ? m[1]! : "project.zip" };
      }
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        // not JSON
      }
      if (!res.ok) {
        throw new ApiError(data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `HTTP ${res.status}`, res.status);
      }
      return data as ProjectExportResult;
    },
  },
  traces: {
    list: () => call<{ dir: string; files: TraceFileEntry[] }>("GET", "/api/traces"),
    records: (name: string, from: number, count: number, filters: { channels?: string; driver?: string; text?: string }) =>
      call<{ name: string; from: number; count: number; matched: number; total: number; drivers: string[]; records: TraceRec[] }>("GET", `/api/traces/records?name=${q(name)}&from=${from}&count=${count}${filters.channels ? `&channels=${q(filters.channels)}` : ""}${filters.driver ? `&driver=${q(filters.driver)}` : ""}${filters.text ? `&text=${q(filters.text)}` : ""}`),
    remove: (name: string) => call<{ ok: boolean }>("POST", "/api/traces/delete", { name }),
    fileUrl: (name: string) => `/api/traces/file?name=${q(name)}${token() ? `&token=${q(token())}` : ""}`,
    /** the raw file as the body; the server checks the size against its limit as it streams */
    upload: async (file: File) => {
      const res = await fetch(`/api/traces/upload?name=${q(file.name)}`, { method: "POST", headers: { "X-IDMWeb-Token": token(), ...(csrf ? { "X-IDMWeb-CSRF": csrf } : {}), "Content-Type": "application/octet-stream" }, body: file });
      const body = (await res.json()) as { ok?: boolean; name?: string; error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `upload failed (${res.status})`);
      }
      return body as { ok: boolean; name: string };
    },
  },
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
    /** The model's schema against the environment's live one, or (with `other`) two environments' live schemas; nothing written. */
    schemaDiff: (env: string, other?: string) => call<SchemaDiffResult>("GET", `/api/vault/schema-diff?env=${q(env)}${other ? `&other=${q(other)}` : ""}`),
    diff: (env: string, drivers: string[]) => call<VaultDiffResult>("GET", `/api/vault/diff?env=${q(env)}${drivers.map((d) => `&driver=${q(d)}`).join("")}`),
    plan: (env: string, drivers: string[], choices: DeployChoices) => call<DeployResult>("POST", "/api/vault/plan", { env, drivers, ...choices }),
    /** #136: record the environment's current state on an as-found branch when it isn't the known one; writes nothing to the vault (deployers). */
    capture: (env: string) => call<DeployResult>("POST", "/api/vault/capture", { env }),
    snapshots: (env: string) => call<{ environment: string; dir: string; snapshots: VaultSnapshot[] }>("GET", `/api/vault/snapshots?env=${q(env)}`),
    /** Put a snapshot back; the environment's name typed again (deployers). */
    rollback: (env: string, snapshot: string, confirm: string, server?: string | null) => call<DeployResult>("POST", "/api/vault/rollback", { env, snapshot, confirm, ...(server ? { server } : {}) }),
    /** `confirm` is the environment's name, typed by the person: the server refuses anything else. */
    deploy: (env: string, drivers: string[], choices: DeployChoices, confirm: string) => call<DeployResult>("POST", "/api/vault/deploy", { env, drivers, ...choices, confirm }),
    /** Start a deploy on the server and follow it with `task`: `{task}` at once, or a refusal (another write is running). */
    deployStart: (env: string, drivers: string[], choices: DeployChoices, confirm: string) => call<DeployResult & { task?: string }>("POST", "/api/vault/deploy", { env, drivers, ...choices, confirm, async: true }),
    rollbackStart: (env: string, snapshot: string, confirm: string, server?: string | null) => call<DeployResult & { task?: string }>("POST", "/api/vault/rollback", { env, snapshot, confirm, ...(server ? { server } : {}), async: true }),
    /** A deploy or rollback by id, or the latest for an environment; `{}` when there is none. */
    task: (by: { id: string } | { env: string }) => call<VaultTask | Record<string, never>>("GET", "id" in by ? `/api/vault/task?id=${q(by.id)}` : `/api/vault/task?env=${q(by.env)}`),
    status: (env: string) => call<VaultStatus>("GET", `/api/vault/status?env=${q(env)}`),
    servers: (env: string) => call<{ environment: string; primary: string | null; servers: { dn: string; name: string; url: string | null; primary: boolean }[] }>("GET", `/api/vault/servers?env=${q(env)}`),
    driver: (env: string, driver: string, action: string, confirm: string) => call<LifecycleResult>("POST", "/api/vault/driver", { env, driver, action, confirm }),
    jobs: (env: string) => call<VaultJobs>("GET", `/api/vault/jobs?env=${q(env)}`),
    rbe: (env: string) => call<VaultPolicies>("GET", `/api/vault/rbe?env=${q(env)}`),
    health: (env: string, driver: string) => call<DriverHealth>("GET", `/api/vault/health?env=${q(env)}&driver=${q(driver)}`),
    engine: (env: string) => call<EngineInfo>("GET", `/api/vault/engine?env=${q(env)}`),
    driverStatus: (env: string, driver: string) => call<DriverDetail>("GET", `/api/vault/driver-status?env=${q(env)}&driver=${q(driver)}`),
    traceShow: (env: string, driver: string) => call<TraceShow>("GET", `/api/vault/trace-show?env=${q(env)}&driver=${q(driver)}`),
    /** The trace file (an empty string clears it); deployers, the environment's name typed again. */
    traceFile: (env: string, driver: string, file: string, confirm: string) => call<OperateOutcome>("POST", "/api/vault/trace-level", { env, driver, file, confirm }),
    traceReset: (env: string, driver: string, confirm: string) => call<OperateOutcome>("POST", "/api/vault/trace-reset", { env, driver, confirm }),
    /** The driver's trace file over SSH (the environment's own host and user); kept as one of your trace files. */
    traceTail: (env: string, driver: string, req: { lines?: number; grep?: string; since?: number; confirm: string }) => call<TraceTailResult>("POST", "/api/vault/trace-tail", { env, driver, ...req }),
    /** The vault's state into this branch's tree (#67): a dry run returns the files that would change; `revision` guards the apply. */
    /** `files`: on an apply, take only those of the reviewed files (a granular update); omitted, all of them. */
    pull: (env: string, drivers: string[], dryRun: boolean, revision: string, files?: string[], contents?: Record<string, string>) =>
      call<PullResult>("POST", "/api/vault/pull", { env, drivers, dryRun, revision, ...(files ? { files } : {}), ...(contents ? { contents } : {}) }),
    resync: (env: string, driver: string, since: string | undefined, confirm: string) => call<OperateOutcome>("POST", "/api/vault/resync", { env, driver, since, confirm }),
    migrate: (env: string, driver: string, xds: string, confirm: string) => call<OperateOutcome>("POST", "/api/vault/migrate", { env, driver, xds, confirm }),
    submit: (env: string, driver: string, xds: string, canary: boolean, confirm: string) => call<OperateOutcome>("POST", "/api/vault/submit", { env, driver, xds, canary, confirm }),
    namedPasswords: (env: string, driver: string) => call<NamedPasswords>("GET", `/api/vault/named-passwords?env=${q(env)}&driver=${q(driver)}`),
    /** Set (the value is write-only, never returned) or remove a named password in the vault. */
    namedPassword: (env: string, driver: string, action: "set" | "remove", name: string, value: string | undefined, confirm: string) => call<OperateOutcome>("POST", "/api/vault/named-password", { env, driver, action, name, value, confirm }),
    /** Clear a driver's recorded health status (deployers; the environment's name typed again). */
    healthClear: (env: string, driver: string, confirm: string) => call<LifecycleResult>("POST", "/api/vault/health-clear", { env, driver, confirm }),
    /** A driver's log level, or the driver set's when `driver` is empty. */
    logLevel: (env: string, driver?: string) => call<LogLevel>("GET", `/api/vault/log-level?env=${q(env)}${driver ? `&driver=${q(driver)}` : ""}`),
    /** Set a log level by name, a limit, or put a driver back on the set's settings (deployers). */
    logLevelSet: (env: string, req: { driver?: string; level?: string; limit?: number; inherit?: boolean; confirm: string }) => call<LifecycleResult>("POST", "/api/vault/log-level", { env, ...req }),
    rights: (env: string, driver: string, dn: string, attrs: string[]) => call<DriverRights>("GET", `/api/vault/rights?env=${q(env)}&driver=${q(driver)}&dn=${q(dn)}${attrs.length ? `&attr=${q(attrs.join("\n"))}` : ""}`),
    driverset: (env: string) => call<DriverSetAdmin>("GET", `/api/vault/driverset?env=${q(env)}`),
    metrics: (env: string, base?: string) => call<EngineMetrics>("GET", `/api/vault/metrics?env=${q(env)}${base ? `&base=${q(base)}` : ""}`),
    workOrders: (env: string, base?: string) => call<WorkOrders>("GET", `/api/vault/workorders?env=${q(env)}${base ? `&base=${q(base)}` : ""}`),
    emailServer: (env: string) => call<EmailServer>("GET", `/api/vault/email-server?env=${q(env)}`),
    /** The SMTP settings that are not secret (deployers); the password is set from the CLI and the secrets file. */
    emailServerSet: (env: string, values: Record<string, string>, confirm: string) => call<LifecycleResult>("POST", "/api/vault/email-server", { env, values, confirm }),
    rbeMembers: (env: string, policy: string) => call<PolicyMembers>("GET", `/api/vault/rbe-members?env=${q(env)}&policy=${q(policy)}`),
    /** Ask the connected system through the running driver; a production environment wants its name typed again. */
    query: (env: string, req: { driver: string; className?: string; scope?: string; dn?: string; association?: string; search?: string[]; readAttrs?: string[]; confirm?: string }) => call<AppQueryResult>("POST", "/api/vault/query", { env, ...req }),
    /** StartJob / AbortJob (deployers; the environment's name typed again). */
    job: (env: string, job: string, driver: string | null, action: "start" | "abort", confirm: string) => call<LifecycleResult>("POST", "/api/vault/job", { env, job, driver, action, confirm }),
    /** A driver's start option, live (deployers; the environment's name typed again). */
    startOption: (env: string, driver: string, option: "auto" | "manual" | "disabled", confirm: string) => call<LifecycleResult>("POST", "/api/vault/start-option", { env, driver, option, confirm }),
    associations: (env: string, driver: string, state?: string, limit = 200) => call<DriverAssociations>("GET", `/api/vault/associations?env=${q(env)}&driver=${q(driver)}${state ? `&state=${q(state)}` : ""}&limit=${limit}`),
    inspect: (env: string, dn: string) => call<ObjectInspection>("GET", `/api/vault/inspect?env=${q(env)}&dn=${q(dn)}`),
    passwordSync: (env: string, driver: string) => call<PasswordSync>("GET", `/api/vault/password-sync?env=${q(env)}&driver=${q(driver)}`),
    cache: (env: string, driver: string, from = 0, count = 200, fresh = false) => call<CacheView>("GET", `/api/vault/cache?env=${q(env)}&driver=${q(driver)}&from=${from}&count=${count}${fresh ? "&fresh=true" : ""}`),
    cacheFileUrl: (env: string, driver: string, kind: "cache" | "input") => `/api/vault/cache-file?env=${q(env)}&driver=${q(driver)}&kind=${kind}${token() ? `&token=${q(token())}` : ""}`,
    cacheEventCase: (env: string, req: { driver: string; index: number; name?: string; channel?: string; replace?: boolean; dryRun?: boolean }) => call<CaseFiles>("POST", "/api/vault/cache-event-case", { env, ...req }),
    cacheDeleteEvent: (env: string, driver: string, index: number, confirm: string) => call<{ ok: boolean; text: string; snapshot?: string }>("POST", "/api/vault/cache-delete", { env, driver, index, confirm }),
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
export function followTrace(env: string, driver: string | null, engine: boolean, onRecord: (r: TraceRec | { error: string }) => void, onState: (state: "open" | "closed" | { failed: string } | { recording: string }) => void, server?: string, record?: boolean): () => void {
  const es = new EventSource(`/api/vault/trace?env=${q(env)}${driver ? `&driver=${q(driver)}` : ""}${engine ? "&engine=true" : ""}${server ? `&server=${q(server)}` : ""}${record ? "&record=true" : ""}&token=${q(token())}`);
  es.addEventListener("open", (ev) => {
    onState("open");
    try {
      const d = JSON.parse((ev as MessageEvent<string>).data) as { recording?: string };
      if (d.recording) {
        onState({ recording: d.recording });
      }
    } catch {
      // the open event may carry nothing
    }
  });
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
