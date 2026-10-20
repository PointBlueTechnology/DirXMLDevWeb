// What the server returns (src/main/java/.../TreeService.java).

export interface Session {
  name: string;
  version: string;
  core: string | null;
  /** #126: a newer DirXMLDevWeb release, from the server's daily check; null when current, unknown or the check is off. */
  newerRelease?: { version: string; url: string | null } | null;
  mode: "local" | "hosted";
  /** Hosted mode with no repository yet: the first-run setup is needed. */
  setup?: boolean;
  project?: string | null;
  csrf: string;
  user: { subject: string; name: string; email: string | null; editor: boolean; deployer: boolean };
  workspace: string | null;
  branch: string | null;
  tree: string | null;
  revision: string | null;
}

export interface ProjectInfo {
  name: string;
  repository: string | null;
  inPlace: string | null;
  base: string;
  tree: string;
}

export interface WorkspacesInfo {
  mode: "local" | "hosted";
  setup?: boolean;
  projects?: ProjectInfo[];
  project?: string;
  inPlace?: boolean;
  open: { id: string; branch: string | null; tree: string }[];
  current: string | null;
  repository?: string;
  base?: string;
  branches?: string[];
  /** The person's own branches (their workspaces on the server), pushed or not. */
  yours?: { branch: string; pushed: boolean; ahead: number }[];
}

export interface GitStatus {
  repository: boolean;
  top?: string;
  branch?: string;
  changed?: { status: string; file: string }[];
  last?: { hash: string; author: string; when: string; subject: string };
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  remote?: string | null;
  base?: string | null;
  compareUrl?: string | null;
  /** docs/git-workflow.md: this branch can be merged into the base on this page (no GitHub or GitLab), else why not. */
  mergeHere?: boolean;
  mergeReason?: string | null;
  /** Merged branches can be deleted on this page (a repository with no GitHub or GitLab in front of it). */
  branchCleanup?: boolean;
}

/** Branches whole in the base (GET /api/git/merged-branches). */
export interface MergedBranches {
  base: string;
  /** The branch this person has open: not deleted. */
  open: string;
  branches: { branch: string; when: string; author: string; commit: string; yourCopy: boolean }[];
}

/** A conflicting file of a merge, to settle on the page: this branch's version, the incoming one, git's merge with its marks. */
export interface ConflictFile {
  file: string;
  kind: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  merged: string | null;
  language?: string | null;
}

/** The conflicts of a merge (POST /api/git/conflicts): the two commits it was between, to resolve against. */
export interface Conflicts {
  ref: string;
  head: string;
  theirs: string;
  branch: string;
  files: ConflictFile[];
  mergedCleanly: string[];
  message: string;
}

/** What merging the open branch into the base would carry (GET /api/git/merge-into-base). */
export interface MergePreview {
  branch: string;
  base: string;
  commits: { hash: string; author: string; subject: string }[];
  files: { status: string; file: string }[];
  /** Commits on the base this branch lacks: the merge would hold content no environment tested. */
  behind: number;
  uncommitted: number;
}

export interface MergeResult {
  merged: boolean;
  message: string;
  commit?: string;
  conflicts?: string[];
}

export interface ArtifactNode {
  path: string;
  name: string;
  kind: string;
  file: string | null;
}

export interface FileNode {
  name: string;
  file: string | null;
  kind?: string;
}

export interface DriverOutline {
  name: string;
  dn: string | null;
  shimClass: string | null;
  dir: string;
  config: string[];
  policies: { driver: ArtifactNode[]; subscriber: ArtifactNode[]; publisher: ArtifactNode[] };
  resources: ArtifactNode[];
  entitlements: FileNode[];
  /** The driver's jobs (DirXML-Job): name, file, disabled, class. */
  jobs: (FileNode & { disabled?: boolean; javaClass?: string | null })[];
  forms: FileNode[];
  prds: { name: string; files: string[] }[];
}

export interface Outline {
  revision: string;
  tree: string;
  driverSet: {
    name: string;
    dn: string | null;
    config: string[];
    servers: { dn: string; name: string; primary: boolean }[];
    linkage: { dn: string; name: string; order: string | null; type: string | null }[];
    packages: Record<string, string>;
    meta: Record<string, string>;
    libraryItems: number;
    /** The set's own jobs (a statistics job, …). */
    jobs: (FileNode & { disabled?: boolean; javaClass?: string | null })[];
    /** The vault schema in the tree, when read: counts, source, read-at. */
    schema: { source?: string; "read-at"?: string; attributes: number; classes: number; customAttributes: number; customClasses: number } | null;
  };
  library: { policies: ArtifactNode[]; resources: ArtifactNode[] };
  drivers: DriverOutline[];
}

export interface Ref {
  kind: string;
  from: string;
  detail: string;
}

export interface Artifact {
  revision: string;
  path: string;
  name: string;
  kind: string;
  scope: string;
  driver: string | null;
  file: string | null;
  language: string;
  content: string;
  editable: boolean;
  packaged: boolean;
  refs: Ref[];
}

export interface TreeFile {
  revision: string;
  file: string;
  language: string;
  content: string;
}

export interface Finding {
  severity: string;
  code: string;
  path: string;
  message: string;
  detail?: string;
}

export interface Validation {
  ok: boolean;
  counts: { error: number; warning: number; info: number };
  findings: Finding[];
  revision: string;
}

export interface OpArg {
  name: string;
  required: boolean;
  help: string;
  file: boolean;
}

export interface OpSpec {
  name: string;
  help: string;
  args: OpArg[];
}

/** One operation an editor wants to run: the core's name and arguments, and a line for the reviewer. */
export interface OpCall {
  name: string;
  args: Record<string, string>;
  files?: Record<string, string>;
  /** What this change is, in the editor's words. */
  label: string;
  /** Edits with the same key replace each other (typing in one field twice is one change). */
  key?: string;
}

export interface FileDiff {
  file: string;
  status: "changed" | "added" | "deleted";
  language: string;
  before?: string;
  after?: string;
}

export interface Definition {
  name: string;
  displayName: string;
  type: string;
  value: string;
  editable: boolean;
  description: string;
  choices: { value: string; label: string }[];
  owner?: string;
  /** driver (its own), driver-link (a GCV resource the driver links), driverset, driverset-link (a Library resource linked at the set). */
  scope?: "driver" | "driver-link" | "driverset" | "driverset-link";
  overrideKey?: string;
  /** Where the GCV is read: policies by artifact path, a driver's configuration documents by file. */
  usedBy?: { kind: string; path: string; file?: string }[];
}

export interface ConfigView {
  revision: string;
  driver: string | null;
  shimClass?: string | null;
  shimAuthServer?: string | null;
  shimAuthId?: string | null;
  /** The environments the driver is deployed to; empty = every environment. */
  environments?: string[];
  /** Environment → the name its vault gives the driver, where it differs (overrides/<env>.properties drivers/<d>.name). */
  environmentNames?: Record<string, string>;
  params?: Definition[];
  ecvs?: Definition[];
  gcvs: Definition[];
}

export interface OverrideRow {
  key: string;
  resolved: boolean;
  problem: string | null;
  base: string | null;
  values: Record<string, string>;
}

export interface OverridesData {
  revision: string;
  environments: string[];
  overrides: OverrideRow[];
}

export interface OpResult {
  operation: string;
  ok: boolean;
  dryRun: boolean;
  written: boolean;
  refusal?: string;
  touched: string[];
  customized: string[];
  changedFiles: string[];
  deletedFiles: string[];
  notes: string[];
  newErrors: { code: string; path: string; message: string }[];
  revision: string;
  /** On a dry run: each file the change would touch, before and after. */
  diffs?: FileDiff[];
}

/** The things the New menus create (roles and resources are made in the Roles view). */
export type NewWhat = "policy" | "mapping-table" | "ecmascript" | "gcv" | "entitlement" | "form" | "prd" | "entity" | "driver";
export const NEW_WHATS: NewWhat[] = ["policy", "mapping-table", "ecmascript", "gcv", "entitlement", "form", "prd", "entity", "driver"];

/** What the main pane shows. */
export type Selection =
  | { type: "home" }
  | { type: "flow"; driver: string }
  | { type: "artifact"; path: string }
  | { type: "file"; file: string }
  | { type: "config"; driver: string | null }
  | { type: "driverset"; tab?: "overview" | "gcvs" | "schema" | "designer" }
  | { type: "overrides" }
  | { type: "vault" }
  | { type: "trace"; env?: string; file?: string; popout?: "1" }
  | { type: "traces" }
  | { type: "simulator" }
  | { type: "prd"; driver: string; name: string }
  | { type: "form"; driver: string; name: string }
  | { type: "roles" }
  | { type: "packages" }
  | { type: "connections"; env?: string }
  | { type: "entitlement"; driver: string; name: string; file: string }
  | { type: "new"; what: NewWhat; driver: string | null }
  | { type: "changes"; against?: "head" | "base" | "upstream" }
  | { type: "audit" }
  | { type: "projects" }
  | { type: "architecture" }
  | { type: "developer" }
  | { type: "operations" };

/** One audit line: who did what, where, with what (names and flags only), and how it went. */
export interface AuditEntry {
  time: string;
  user: string | null;
  workspace: string | null;
  project: string | null;
  branch: string | null;
  event: string;
  details: Record<string, unknown>;
  outcome: string;
}

/** An environment of the environments file, described without its values. */
export interface VaultEnvironment {
  name: string;
  tier: string;
  ready: boolean;
  hasOverrides: boolean;
  /** The project defines it (URL and driver set present). */
  defined?: boolean;
  /** The person has a bind DN and a password source for it. */
  connected?: boolean;
  /** Named only in the person's own file (a hosted server with two files). */
  own?: boolean;
}

export interface VaultEnvironments {
  available: boolean;
  /** A hosted server: the project's definitions and the person's credentials are two files. */
  split?: boolean;
  why?: string;
  file?: string;
  environments: VaultEnvironment[];
}

export interface VaultChange {
  kind: string;
  driver: string | null;
  path: string;
  what: string | null;
  summary: string;
  detail?: string | null;
}

/** Two environments' vaults side by side (`/api/vault/compare-envs`); "expected" = the tree already accounts for it. */
export interface EnvCompareResult {
  a: string;
  b: string;
  onlyIn: { driver: string; env: string; expected: boolean; notInTree: boolean }[];
  values: { driver: string | null; key: string; a: string | null; b: string | null; expected: boolean }[];
  drift: { empty: boolean; changes: VaultChange[] } | null;
  notes: string[];
  text: string;
}

export interface VaultDiffResult {
  empty: boolean;
  changes: VaultChange[];
  affectedDrivers: string[];
  environment: string;
  tier: string;
  text: string;
  overrides: string | null;
  /** What the read could not take: another server unreachable, a value eDirectory can't return (-325). */
  notes?: string[];
  /** Drivers the tree doesn't deploy to this environment (driver.xml environments), left out of the comparison. */
  notDeployed?: string[];
  /** The tree's name → this environment's, for drivers its vault names differently. */
  renamed?: Record<string, string>;
}

/** What a deploy asks for beyond its scope (#34). */
export interface DeployChoices {
  restart: boolean;
  /** none (leave secrets alone), missing (set named passwords the vault lacks), all (re-set every provided secret). */
  secrets: "none" | "missing" | "all";
  /** A first deploy may create the driver stopped when a secret is not provided. */
  allowMissingSecrets: boolean;
  /** Drivers the diff reports as only in the vault, to delete (stopped ones only; the core refuses otherwise). */
  deleteDrivers: string[];
  /** A production environment's unknown or drifted state captured first as an as-found branch (vault.deploy --capture-drift). */
  captureDrift?: boolean;
}

/** The vault's state taken into the workspace's tree (#67): a dry run's per-file diff, or what an apply wrote. */
export interface PullResult {
  ok: boolean;
  dryRun: boolean;
  written: boolean;
  environment: string;
  drivers: string[];
  changedFiles: string[];
  deletedFiles: string[];
  diffs?: FileDiff[];
  notes: string[];
  unresolvedLinks: number;
  revision: string;
  /** When the vault's side was read (epoch ms), and whether it was the last Compare's read rather than a new one. */
  readAt?: number;
  reused?: boolean;
}

/** A snapshot a deploy (or a rollback) took before writing. */
export interface VaultSnapshot {
  file: string;
  name: string;
  server: string | null;
  bytes: number;
  ok: boolean;
  message?: string;
  timestamp?: string;
  label?: string | null;
  user?: string | null;
  treeCommit?: string | null;
  objects?: number;
  drivers?: number;
}

export interface DeployResult {
  ok: boolean;
  environment: string;
  refusal?: string | null;
  failure?: string | null;
  plan?: string | null;
  diff?: string | null;
  done?: string[];
  skipped?: string[];
  restarted?: string[];
  secretsSet?: string[];
  snapshot?: string | null;
  verified?: boolean;
  verify?: string | null;
  text?: string;
  /** The production gate refused for an unknown or drifted current state: capture-drift is the way on. */
  driftRefused?: boolean;
  /** The as-found branch a capture made, to merge under this branch's change. */
  capturedBranch?: string | null;
  /**
   * Which production check stood in the way (with refusal), or what a plan foresees (with gate) — #136: confirm,
   * not-in-git, uncommitted, branch, push, behind, requires, unknown-state, drift; after a capture: captured,
   * verified or known.
   */
  gateKind?: string | null;
  /** A plan against production: what a deploy would be refused for, in the core's words. */
  gate?: string | null;
  tier?: string;
  /** Another deploy or rollback to the environment is running: this one was not started. */
  busy?: boolean;
}

/** A deploy or rollback the server runs (GET /api/vault/task): its progress line by line, and its result when done. */
export interface VaultTask {
  id: string;
  kind: "deploy" | "rollback";
  env: string;
  user: string;
  project?: string | null;
  branch?: string | null;
  startedAt: number;
  finishedAt: number | null;
  running: boolean;
  lines: { at: number; text: string }[];
  result: DeployResult | null;
  /** The server's clock when it answered, to show elapsed time whatever the browser's clock says. */
  now: number;
}

export interface DriverState {
  name: string;
  dn: string;
  state: string;
  startOption: string;
  cacheSize?: string;
  unprocessedSize?: string;
  traceLevel?: string;
}

export interface VaultStatus {
  environment: string;
  ok: boolean;
  drivers: DriverState[];
  text: string;
}

/** The jobs of the driver set with the engine's state (`job.list`). */
export interface VaultJobs {
  ok: boolean;
  jobs: { name: string; dn: string; owner: string; driver: string | null; javaClass: string; disabled: boolean; servers: number; running: string; config: string; scheduled: string; nextRun: string }[];
  text: string;
}

/** The engine's version and its statistics (`engine.version`, `engine.stats`). */
export interface EngineInfo {
  ok: boolean;
  version: { ok: boolean; error?: string; version?: string; text: string };
  stats: {
    ok: boolean;
    error?: string;
    jvm?: { heapUsed: string; heapCommitted: string; heapTotal: string; threadsCurrent: string; threadsDaemon: string; threadsPeak: string };
    drivers?: { name: string; cacheSize: string | number; unprocessedSize: string | number; reportedEvents: string | number; commands: string | number }[];
    text: string;
  };
}

/** One driver as `driver.status --json` reports it. */
export interface DriverDetail {
  ok: boolean;
  error?: string;
  name?: string;
  dn?: string;
  state?: string;
  startOption?: string;
  cacheSize?: string | number;
  unprocessedSize?: string | number;
  traceLevel?: string | number | null;
  traceFile?: string | null;
  namedPasswords?: string[];
  audit?: { timestamp: string; outcome: string; detail: string }[];
  text: string;
}

/** `driver.trace show`, and whether the environment can read the trace file over SSH. */
export interface TraceShow {
  ok: boolean;
  error?: string;
  level?: string | number | null;
  file?: string | null;
  sshTail?: boolean;
  text: string;
}

/** The trace file's lines over SSH, kept as one of the person's trace files (`stored`). */
export interface TraceTailResult {
  ok: boolean;
  text: string;
  file?: string;
  lines?: string[];
  stored?: string;
}

/** A driver's named passwords in the vault, names only (`driver.secrets list`). */
export interface NamedPasswords {
  ok: boolean;
  error?: string;
  names?: string[];
  text: string;
}

/** A driver operation's outcome (resync, migrate, submit, named password, trace file/reset). */
export interface OperateOutcome {
  ok: boolean;
  text: string;
  canary?: "MATCH" | "MISMATCH" | null;
}

/** A driver's health as the Driver Health job recorded it, its health configuration, the set's health jobs (`driver.health`). */
export interface DriverHealth {
  ok: boolean;
  error?: string;
  driver?: string;
  states?: { server: string; state: string; customState?: string }[];
  configured?: { state: string; conditionGroups: number; actions: number }[];
  jobs?: { name: string; dn: string; disabled: boolean; inScope: boolean }[];
  text: string;
}

/** The log level of a driver or the driver set (`driver.log-level`). */
export interface LogLevel {
  ok: boolean;
  error?: string;
  dn?: string;
  inherits?: boolean;
  level?: number | null;
  levelName?: string;
  events?: number[];
  limit?: number | null;
  eventsType?: number | null;
  text: string;
}

/** The driver object's effective rights on an object (`driver.rights`). */
export interface DriverRights {
  ok: boolean;
  error?: string;
  trustee?: string;
  dn?: string;
  rights?: { attribute: string; bits: number; names: string; error?: string }[];
  text: string;
}

/** The driver set's administration: activation and servers (`driverset.activation`, `driverset.servers`). */
export interface DriverSetAdmin {
  ok: boolean;
  activation: { ok: boolean; error?: string; attributes?: { attribute: string; value: string }[]; activation?: string; viewError?: string; text: string };
  servers: { ok: boolean; error?: string; servers?: string[]; connectedServerRuns?: string | null; text: string };
}

/** Users and associations, counted (`engine.metrics`). */
export interface EngineMetrics {
  ok: boolean;
  error?: string;
  users?: number;
  associated?: number;
  enabled?: number;
  drivers?: { name: string; dn: string; disabled: number; processed: number; pending: number; manual: number; migrate: number }[];
  text: string;
}

/** The Work Order driver's objects (`workorder.list`). */
export interface WorkOrders {
  ok: boolean;
  error?: string;
  total?: number;
  workOrders?: { name: string; dn: string; status: string; due: string; description: string }[];
  text: string;
}

/** The notification collection's SMTP settings (`vault.email-server`); the password only as set or not. */
export interface EmailServer {
  ok: boolean;
  error?: string;
  dn?: string;
  host?: string | null;
  port?: string | null;
  from?: string | null;
  user?: string | null;
  tls?: string | null;
  timeout?: string | null;
  protocol?: string | null;
  auth?: string | null;
  passwordSet?: boolean;
  text: string;
}

/** The driver set's entitlement policies with the directory's member counts and the grants (`rbe.list`). */
export interface VaultPolicies {
  ok: boolean;
  container: string | null;
  policies: { name: string; dn: string; priority: number | null; members: number; memberQuery: string; grants: { entitlement: string; ref: string }[] }[];
  text: string;
}

/** The members the directory computes for one policy (`rbe.members`). */
export interface PolicyMembers {
  ok: boolean;
  dn?: string;
  error?: string;
  members?: string[];
  text: string;
}

/** The application's answer to a query through the driver (`driver.query`). */
export interface AppQueryResult {
  ok: boolean;
  driver?: string;
  count?: number;
  error?: string;
  instances?: { className: string; srcDn: string; association: string; attrs: Record<string, string[]> }[];
  status?: string;
  xds?: string;
  text: string;
}

/** The objects associated with a driver, by state (`driver.associations`). */
export interface DriverAssociations {
  ok: boolean;
  driver: string;
  counts: Record<string, number>;
  total: number;
  listed: number;
  objects: { dn: string; state: string; value: string }[];
  text: string;
}

/** One object as the vault has it (`object.inspect`). */
export interface ObjectInspection {
  ok: boolean;
  dn: string;
  error?: string;
  objectClass?: string[];
  associations?: { driver?: string; driverDn?: string; state?: string; value?: string; raw?: string }[];
  passwordSync?: { driver: string; driverDn: string; time: string; status: string }[];
  text: string;
}

/** The driver set's sync timeout and a driver's password settings (`driver.password-sync`). */
export interface PasswordSync {
  ok: boolean;
  driver: string;
  driverSetTimeout: string;
  settings: { name: string; value: string }[];
  text: string;
}

export interface LifecycleResult {
  ok: boolean;
  text: string;
  driver: string;
  action: string;
}

export interface SimCase {
  name: string;
  driver: string | null;
  channel: string;
  hasExpected: boolean;
}

export interface SimCases {
  dir: string;
  exists: boolean;
  cases: SimCase[];
}

export interface SimCaseFiles {
  name: string;
  driver: string | null;
  channel: string;
  properties: string | null;
  input: string | null;
  expected: string | null;
  assertions: string | null;
  directory: string | null;
}

export interface SimRun {
  ok: boolean;
  pass: number;
  fail: number;
  error: number;
  skip: number;
  cases: { name: string; outcome: string; detail: string }[];
  notes: string[];
}

export interface SimStage {
  name: string;
  input: string;
  output: string;
  changed: boolean;
  trace: string | null;
  queries: string[];
  commands: string[];
  error: string | null;
}

export interface SimDetail {
  name: string;
  ok: boolean;
  error?: string;
  stages?: SimStage[];
  final?: string;
  trace?: string;
  warnings?: string[];
  outcome?: string;
  outcomeDetail?: string;
  notes: string[];
  against?: { environment: string | null; same?: boolean; firstDivergesAt?: string | null; finalDetail?: string; stages?: { name: string; same: boolean; detail: string }[]; error?: string };
}

export interface FlowActivity {
  id: string;
  kind: string;
  name: string | null;
  attrs: Record<string, string>;
  parts: Record<string, string>;
  xml: string;
  linkTypes: string[];
  dataItems: { name: string; dataType: string | null; source: string | null; target: string | null; targetType: string | null }[];
  form: string | null;
}

export interface FlowLink {
  from: string;
  to: string;
  type: string;
}

export interface PrdData {
  driver: string;
  name: string;
  dir: string;
  status: string | null;
  jsonForms: boolean;
  properties: Record<string, string[]>;
  bindings: { activity: string | null; form: string; fields: { name: string; dataType: string | null; control: string | null }[] }[];
  forms: string[];
  flow: { process: Record<string, string | null>; activities: FlowActivity[]; links: FlowLink[]; linkTypes: string[] } | null;
}

export interface FormData {
  driver: string;
  name: string;
  kind: string;
  file: string;
  json: string;
  usedBy: { prd: string; activity: string | null; fields: string[] }[];
}

export interface CatalogObject {
  driver: string;
  name: string;
  path: string;
  displayName: string | null;
  container: string;
  attrs: Record<string, string[]>;
}

export interface EntityAttribute {
  key: string;
  ldap: string | null;
  nds: string | null;
  type: string | null;
  display: string | null;
  flags: Record<string, boolean>;
}

export interface EntityDef {
  driver: string;
  key: string;
  path: string;
  displayName: string | null;
  objectClass?: string | null;
  searchRoot?: string | null;
  attributes: EntityAttribute[];
  error?: string;
}

export interface RoleCatalog {
  drivers: string[];
  roles: CatalogObject[];
  resources: CatalogObject[];
  entities: EntityDef[];
  /** Per driver, the role and resource category lists; a list is null when the tree has none (older cores send no field). */
  categories?: Record<string, { role: Category[] | null; resource: Category[] | null }>;
}

/** A category key of the Directory Abstraction Layer's roles-category / resources-category list. */
export interface Category {
  key: string;
  label: string;
  labels: Record<string, string>;
  used: number;
}

export interface CatalogPackage {
  short: string;
  id: string | null;
  displayName: string | null;
  type: number;
  base: boolean;
  versions: string[];
  newest: string | null;
  /** The feature packages the newest version declares (short is null when the catalog lacks the feature). */
  features: { id: string; short: string | null; displayName: string | null; mandatory: boolean; group: string | null }[];
  supportedDrivers: string[];
  hasPrompts: boolean;
}

/** The questions installing a set of packages asks: one entry per prompt, its definitions pre-populated. */
export interface PackagePrompts {
  packages: string;
  prompts: { package: string; version: string; prompt: string; definitions: Definition[]; unanswered: string[]; passwordRefs: string[] }[];
}

export interface InstalledPackage {
  short: string;
  id: string | null;
  version: string | null;
  base: boolean;
  inManifest: boolean;
  objects: number;
  inCatalog: string | null;
  newer: string | null;
}

export interface PackagesData {
  catalog: { dir: string | null; available: boolean; packages: CatalogPackage[] };
  status: { targets: { name: string; packages: InstalledPackage[]; customized: string[]; notes: string[] }[] };
  text: string;
}

export interface UpdateSites {
  available: boolean;
  sites: { name: string; url: string }[];
}

export interface SiteListing {
  url: string;
  ok: boolean;
  error?: string;
  packages: { short: string; displayName: string | null; versions: string[]; newest: string; inCatalog: string[]; newer: boolean }[];
}

export interface FetchResult {
  ok: boolean;
  error?: string;
  added: string[];
  skipped: string[];
  refused: string[];
}

/** `package.import`: a jar from disk into the catalog. */
export interface ImportResult {
  ok: boolean;
  added: boolean;
  short: string | null;
  version: string | null;
  refusal?: string;
}

/** The tree's vault schema (GET /api/schema). */
export interface SchemaData {
  present: boolean;
  source?: string;
  "read-at"?: string;
  attributes?: { name: string; ldap: string; syntax: string | null; single: boolean; custom: boolean }[];
  classes?: { name: string; ldap: string; kind: string; container: boolean; custom: boolean; superclasses: string[] }[];
  customAttributes?: number;
  customClasses?: number;
}

/** One class with the attributes it holds, its superclasses' included (GET /api/schema/class). */
export interface SchemaClass {
  name: string;
  ldap: string;
  oid: string | null;
  kind: string;
  container: boolean;
  custom: boolean;
  superclasses: string[];
  mandatory: string[];
  optional: string[];
  containment: string[];
  naming: string[];
  attributes: { name: string; ldap: string; syntax: string | null; single: boolean; mandatory: boolean }[];
}

/** A driver's application schema as the shim reported it (GET /api/schema/app). */
export interface AppSchema {
  driver: string;
  present: boolean;
  hierarchical?: string;
  classes: { name: string; container: boolean; attributes: { name: string; type: string; multi: boolean; required: boolean; naming: boolean }[] }[];
}

/** A vault schema action: refresh, application refresh, or push (plan / written). */
/** Two schemas side by side: the model against an environment's live schema, or two environments' (#77). */
export interface SchemaDiffResult {
  left: string;
  right: string;
  inSync: boolean;
  attributesCompared: number;
  classesCompared: number;
  counts: Record<string, number>;
  changes: { kind: "attribute" | "class"; name: string; where: "left-only" | "right-only" | "differs"; fields: string[]; custom: boolean }[];
}

export interface SchemaActionResult {
  ok: boolean;
  refusal?: string | null;
  done: string[];
  skipped: string[];
  failures: string[];
  text: string;
  [k: string]: unknown;
}

export interface BuildResult {
  ok: boolean;
  refusal?: string;
  jar: string | null;
  packageId: string | null;
  version: string | null;
  objects: string[];
  notes: string[];
  text: string;
}

export interface ConnectionEnv {
  name: string;
  /** The person's password is a command reference, kept in their file but never run here: they are not a deployer. */
  passwordRefused?: boolean;
  eventsPasswordRefused?: boolean;
  url: string | null;
  bindDn: string | null;
  driverSet: string | null;
  tier: string | null;
  trustAll: string | null;
  /** The pinned certificate's SHA-256 (docs/connections-ui.md), or null. */
  certSha256?: string | null;
  /** `<serverDn>=<url>;…`: addresses given for the driver set's other servers. */
  servers?: string | null;
  requires: string | null;
  sshHost: string | null;
  sshUser: string | null;
  secrets: string | null;
  eventsUrl: string | null;
  eventsUser: string | null;
  eventsTable: string | null;
  eventsPseudonymise: string | null;
  eventsTree: string | null;
  /** "true": production deploys from any branch, not only the base (one environment; docs/git-workflow.md). */
  fromAnyBranch?: string | null;
  /** How the password is configured: literal, env, command, keychain, or null for none. */
  password: string | null;
  /** How the event store's password is configured, the same way; null for none. */
  eventsPassword: string | null;
  secretsFile: string;
  secretsFileExists: boolean;
  ready: boolean;
  /** Two files only (docs/multi-user.md): named by the project's definitions. */
  defined?: boolean;
  /** Two files only: named only in the person's own file. */
  own?: boolean;
  /** Two files only: the person has a bind DN and a password source for it. */
  connected?: boolean;
}

/** A vault's certificate, as the server sees it (SignIn.probe): ok false when the vault can't be reached. */
export interface VaultCertificate {
  ok: boolean;
  message?: string;
  subject?: string;
  issuer?: string;
  notBefore?: string;
  notAfter?: string;
  sha256?: string;
  /** Trusted by the server as is (its certificate authorities, the host name). */
  trusted?: boolean;
  problem?: string | null;
}

/** A sign-in's outcome (SignIn.check): what the list, the forms and the top bar show. */
export interface SignInCheck {
  env?: string;
  state: "ok" | "rejected" | "certificate" | "unreachable" | "error" | "not-signed-in";
  message: string | null;
  reason?: string | null;
  sha256?: string | null;
  subject?: string | null;
  pinned?: string | null;
  passwordExpires?: string | null;
  daysLeft?: number | null;
  graceRemaining?: number | null;
  checkedAt?: number;
  /** A driver set on several servers: how many, and which this server can't reach (#134). */
  servers?: number;
  serversUnreachable?: string[];
}

/** One server of a driver set and the address it is reached at (GET /api/credentials/servers). */
export interface ServerAddress {
  dn: string;
  name: string;
  primary: boolean;
  configured: string | null;
  derived: string | null;
  url: string | null;
  reachable: boolean;
  message?: string | null;
}

export interface Connections {
  /** The file the person's entries go to: their own credentials on a hosted server, else the one file. */
  file: string;
  exists: boolean;
  /** A hosted server: the project's definitions and the person's credentials are two files. */
  split: boolean;
  definitions?: string;
  keychain: boolean;
  /** The directory of the helper scripts a secret-manager reference may call. */
  helpers: string;
  environments: ConnectionEnv[];
}

export interface SecretNeed {
  driver: string;
  key: string;
  kind: string;
  because: string;
  configured: string | null;
}

export interface EnvSecrets {
  environment: string;
  file: string;
  exists: boolean;
  needs: SecretNeed[];
  others: { key: string; configured: string | null }[];
}

/** The Architecture view's model (#32): the driver set and one application per driver. */
export interface Architecture {
  revision: string;
  driverSet: { name: string; dn: string | null; servers: { dn: string; name: string; primary: boolean }[]; drivers: number; libraryItems: number; packages: number };
  applications: ArchApplication[];
}

export interface ArchApplication {
  driver: string;
  dn: string | null;
  shimClass: string | null;
  /** Designer's application type (ActiveDirectory, GenericDatabase, NProv, GenericApp…). */
  type: string;
  /** What a diagram labels it; null for the generic type (the driver's name is used then). */
  typeName: string | null;
  /** No external system: User Application, Loopback, Entitlements Service… drawn beneath the vault. */
  vaultOnly: boolean;
  /** The driver carries an icon (`/api/driver-icon?driver=`). */
  icon: boolean;
  counts: { policies: number; subscriber: number; publisher: number; driver: number; entitlements: number; resources: number; forms: number; prds: number };
}

/** The Developer view's tree (#32 A2): the whole driver set, every node saying what it opens. */
export interface DevNode {
  id: string;
  label: string;
  /** driverset | folder | driver | channel | policyset | policy kinds | file | config | gcv | schema | overrides | filter | entitlement | form | prd */
  kind: string;
  count?: number;
  select?: Record<string, unknown>;
  children?: DevNode[];
  driver?: string;
  typeName?: string | null;
  shimClass?: string | null;
  icon?: boolean;
  unresolved?: boolean;
}

/** A project put away (#76): its bundle and what moved aside. */
export interface ProjectArchive {
  name: string;
  dir: string;
  project: string;
  archivedAt: string | null;
  by: string | null;
  repository: string | null;
  bundle: string | null;
  bytes: number | null;
  moved: string[];
}

export interface ProjectArchiveResult {
  archived: string;
  name: string;
  dir: string;
  bundle: string;
  bytes: number;
  moved: string[];
}

export interface SetupResult {
  project?: string;
  repository?: string;
  inPlace?: string;
  tree?: string;
  base?: string;
  drivers?: number;
  branches?: string[];
  notes?: string[];
}

export interface GitDiff {
  against: string;
  ref: string;
  files: { file: string; status: string; from?: string | null; language?: string; before?: string; after?: string }[];
}

/** The Event Logger's store, per environment (docs/event-logger.md). */
export interface EventsDescribe {
  environment: string;
  configured: boolean;
  ok?: boolean;
  message?: string;
  pseudonymise?: boolean;
  url?: string;
  table?: string;
  rows?: number;
  newest?: string | null;
  minSchemaVersion?: number | null;
  maxSchemaVersion?: number | null;
  migrated?: boolean;
  drivers?: { dn: string; name: string | null }[];
}

export interface EventChange {
  attribute: string;
  removeAll: boolean;
  removed: string[];
  added: string[];
}

export interface EventRow {
  id: number;
  eventId: string | null;
  type: string;
  class: string;
  srcDn: string | null;
  srcEntryId: string | null;
  time: string | null;
  srcDriver: string | null;
  driver: string | null;
  channel: string | null;
  policy: string | null;
  stage: string | null;
  schemaVersion: number;
  json: Record<string, unknown>;
  hasXml?: boolean;
  xml?: string | null;
  changes?: EventChange[];
}

export interface EventDetail extends EventRow {
  sameEvent: EventRow[];
}

export interface CasePlan {
  ok: boolean;
  refusal?: string;
  dir: string | null;
  files: Record<string, string>;
  reconstructed: boolean;
  replaced: boolean;
  name: string;
  written: boolean;
}

/** One queued event of a driver's cache: its position (1-based), what it is, and its document. */
export interface CacheEvent {
  index: number;
  operation: string;
  className: string | null;
  srcDn: string | null;
  eventId: string | null;
  xml?: string;
}

/** A page of a driver's event cache as the core's driver.cache view reports it. */
export interface CacheView {
  environment: string;
  driver: string;
  ok: boolean;
  count?: number;
  from?: number;
  events?: CacheEvent[];
  readAt?: string;
  text?: string;
}

/** The files a case made from a cache would have, or the refusal. */
export interface CaseFiles {
  ok: boolean;
  refusal?: string;
  name?: string;
  dir?: string;
  files?: Record<string, string>;
  replaced?: boolean;
  events?: number;
  written?: boolean;
}

/** A recording or an uploaded trace file on the server. */
export interface TraceFileEntry {
  name: string;
  bytes: number;
  modified: string;
  parsed: boolean;
}

/** The vault and server details a new Designer project carries (`export-project --new`); never a password. */
export interface NewProjectFields {
  vaultName?: string;
  vaultHost?: string;
  vaultUser?: string;
  server?: string;
  serverContext?: string;
}

/** `idm export-project --json`, plus what the page asked for (#66). */
export interface ProjectExportResult {
  ok: boolean;
  operation: string;
  dryRun: boolean;
  written: boolean;
  refusal: string | null;
  createdFiles: string[];
  changedFiles: string[];
  deletedFiles: string[];
  mintedIds: Record<string, string>;
  notes: string[];
  path?: string;
  name?: string;
}

/** A branch's pull request (GitHub) or merge request (GitLab), #35. */
export interface PullRequestRef {
  provider: string;
  number: number;
  url: string;
  state: string;
  title: string;
  draft: boolean;
}

/** What the bar needs to offer a pull request: whether the API can be used, and the branch's open one. */
export interface PullRequestInfo {
  available: boolean;
  /** Why not, when not: the compare page is the fallback. */
  reason: string | null;
  provider: string | null;
  /** Whose account creates it: the person, "the project's repository token", or "<login> (through gh)". */
  as: string | null;
  /** A local install: the CLI that creates it (gh, glab). */
  via?: string | null;
  pushed: boolean;
  branch: string | null;
  base: string | null;
  compareUrl: string | null;
  request?: PullRequestRef | null;
  /** The provider's answer when it could not be asked. */
  error?: string;
  /** The person's own token is configured but could not be read; the project's stood in. */
  personalTokenError?: string;
  title?: string;
  body?: string;
}

export interface PullRequestCreated extends PullRequestInfo {
  ok: boolean;
}

/** A provider host the server's projects use, and whether the person has a token for it (#35 P2). Never the value. */
export interface GitTokenHost {
  host: string;
  provider: string;
  projects: string[];
  set: boolean;
  /** file, env:VAR, command, or null. */
  store: string | null;
  /** A command reference kept in the file but never run here: the person is not a deployer. */
  refused?: boolean;
}

/** Where a project pushes (GET /api/setup/repository). */
export interface ProjectRepository {
  project: string;
  inPlace: boolean;
  /** A repository this server made for the project (by an export from a vault, an upload…), not a remote. */
  serverMade: boolean;
  pushesTo: string | null;
  base: string;
  tree: string;
  cases: string;
  tokenSet: boolean;
  provider: string | null;
}

/** POST /api/setup/repository/check: may the project move to the remote, and what moves. */
export interface RepositoryCheck {
  ok: boolean;
  empty: boolean;
  sameHistory: boolean;
  branches: number;
  tags: number;
  unpushed: { person: string; branch: string; ahead: number; uncommitted: number; pushed: boolean }[];
  message: string;
}
