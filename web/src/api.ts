import type { Artifact, OpResult, OpSpec, Outline, Session, TreeFile, Validation } from "./types";
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
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return sessionStorage.getItem(KEY);
}

function token(): string {
  return sessionStorage.getItem(KEY) ?? "";
}

/** An API error: the server's message, and the HTTP status (409 = the tree moved under a write). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "X-IDMWeb-Token": token(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
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
    throw new ApiError(message, res.status);
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
