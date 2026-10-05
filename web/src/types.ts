// What the server returns (src/main/java/.../TreeService.java).

export interface Session {
  name: string;
  version: string;
  core: string | null;
  tree: string;
  revision: string;
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
  | { type: "operations" };
