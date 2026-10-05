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
}

/** What the main pane shows. */
export type Selection =
  | { type: "home" }
  | { type: "flow"; driver: string }
  | { type: "artifact"; path: string }
  | { type: "file"; file: string }
  | { type: "operations" };
