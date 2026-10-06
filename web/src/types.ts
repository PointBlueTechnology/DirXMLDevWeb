// What the server returns (src/main/java/.../TreeService.java).

export interface Session {
  name: string;
  version: string;
  core: string | null;
  mode: "local" | "hosted";
  csrf: string;
  user: { subject: string; name: string; email: string | null; editor: boolean; deployer: boolean };
  workspace: string | null;
  branch: string | null;
  tree: string | null;
  revision: string | null;
}

export interface WorkspacesInfo {
  mode: "local" | "hosted";
  open: { id: string; branch: string | null; tree: string }[];
  current: string | null;
  repository?: string;
  base?: string;
  branches?: string[];
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
  forms: FileNode[];
  prds: { name: string; files: string[] }[];
}

export interface Outline {
  revision: string;
  tree: string;
  driverSet: { name: string; dn: string | null; config: string[] };
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
  overrideKey?: string;
}

export interface ConfigView {
  revision: string;
  driver: string | null;
  shimClass?: string | null;
  shimAuthServer?: string | null;
  shimAuthId?: string | null;
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

/** What the main pane shows. */
export type Selection =
  | { type: "home" }
  | { type: "flow"; driver: string }
  | { type: "artifact"; path: string }
  | { type: "file"; file: string }
  | { type: "config"; driver: string | null }
  | { type: "overrides" }
  | { type: "vault" }
  | { type: "simulator" }
  | { type: "prd"; driver: string; name: string }
  | { type: "form"; driver: string; name: string }
  | { type: "roles" }
  | { type: "packages" }
  | { type: "connections"; env?: string }
  | { type: "operations" };

/** An environment of the environments file, described without its values. */
export interface VaultEnvironment {
  name: string;
  tier: string;
  ready: boolean;
  hasOverrides: boolean;
}

export interface VaultEnvironments {
  available: boolean;
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

export interface VaultDiffResult {
  empty: boolean;
  changes: VaultChange[];
  affectedDrivers: string[];
  environment: string;
  tier: string;
  text: string;
  overrides: string | null;
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

export interface RoleCatalog {
  drivers: string[];
  roles: CatalogObject[];
  resources: CatalogObject[];
}

export interface CatalogPackage {
  short: string;
  id: string | null;
  displayName: string | null;
  type: number;
  base: boolean;
  versions: string[];
  newest: string | null;
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
  url: string | null;
  bindDn: string | null;
  driverSet: string | null;
  tier: string | null;
  trustAll: string | null;
  requires: string | null;
  sshHost: string | null;
  sshUser: string | null;
  secrets: string | null;
  /** How the password is configured: literal, env, command, keychain, or null for none. */
  password: string | null;
  secretsFile: string;
  secretsFileExists: boolean;
  ready: boolean;
}

export interface Connections {
  file: string;
  exists: boolean;
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
