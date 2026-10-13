# Per-user data: design note

Status: **decided 2026-10-08** (section 7); U1 built (core 0.16.0, web 0.22.0), U2 built (per-person credentials, the split Connections view), U3 built (traces per person, unclaimed-directory notice), U4 built (definitions in full from the page, "set up your connection" in the pickers); see "As built" at the end. Jerry's direction: "each user's workspace
needs to be unique to them. They get their own data, their own connections, nothing shared —
except perhaps secrets."

## 1. What is shared today

Hosted mode already gives each person their own checkout per branch
(`data.dir/workspaces/<project>/<subject>/<branch>`), so the tree, its cases, overrides, deploy
snapshots and the simulator corpus are already theirs until they commit. Everything about the
*vault side* is shared:

| Today | Where | Shared by |
|---|---|---|
| Connections (every environment: URL, bind DN, password source, driver set, tier, trust, SSH, event store) | the server's one `environments.file` | every person, every project |
| Driver secrets (shim, Remote Loader, named passwords) | `secrets-<env>.properties` beside it | every person |
| Trace recordings and uploads | `data.dir/traces/<project>/` | everyone on the project |
| The choice of environment | the browser's `localStorage` | nobody (per browser) |
| Sessions, audit log, package catalog, the repositories | `data.dir` | everyone, by design |

The core reads the environments file through a process-wide path (`IDM_ENVIRONMENTS`, or
`Environments.load()` with no argument). Seven call sites in `CredentialService`, `VaultService`,
`EventsService` and `SetupService` go through that. That is the one real obstacle: the file has
to become a per-request choice.

## 2. The model

Three kinds of thing, three owners:

| Kind | Owner | Holds |
|---|---|---|
| **Environment definition** | the project (deployers edit) | name, tier, vault URL, driver-set DN, `requires`, SSH host, event-store URL and table. No secrets. |
| **Credential** | the person | per environment name: bind DN, where the password comes from, `trustAll`, the event-store account. Theirs alone; never returned, never copied. |
| **Driver secret** | the environment (deployers edit, deploys read) | `secrets-<env>.properties`: shim, Remote Loader and named passwords, each a value or a secret-manager reference. Jerry's exception: these are facts about the environment, and every deploy to it needs the same ones. |

An *effective environment* for one person is a definition plus that person's credential for its
name. No credential means the environment is listed but "not connected" for them. A person may
also define environments of their own (a private lab) in their file with every key; those are
theirs entirely and no one else sees them.

Why split the definition from the credential rather than keep whole entries per person:

- a URL and a driver-set DN are facts about where the project deploys, not about a person; with
  whole entries per person two people can drift (one deploys to the wrong driver set);
- the bind identity is the thing that should be personal: the vault's own audit then shows who
  deployed, and the server never holds a shared production password;
- a new person sees the project's environments at once and only has to supply who they are.

The pure alternative (every entry per person, no definitions) is a smaller change and is what
"nothing shared" says literally. It costs each person retyping the same URLs and DNs, and nothing
stops two people deploying the same tree to different driver sets. Decision 1 below.

## 3. Layout

```
data.dir/
  users/<subject>/                 0700, the person's own data
    profile.properties             name, email, last sign-in (for the admin's listing; subjects are opaque ids)
    environments.properties        their credentials by environment name, and any environments of their own
    git.properties                 their own Git provider tokens by host (#35 P2; docs/pull-requests.md)
    traces/<project>/              their recordings and uploads
  workspaces/<project>/<subject>/<branch>/   as today (snapshots stay inside the checkout)
  environments/
    definitions.properties         the shared definitions (today's environments.file, minus every password key)
    secrets-<env>.properties       the shared driver secrets, deployer-only
```

`<subject>` is the identity provider's subject (an OIDC `sub`, an agent's name). The server
process is one OS user, so separation is the server's to enforce: every read and write of a
person's directory goes through their session, and nothing in another person's directory is ever
listed, read or returned. Files are created `0600`, directories `0700`, as the credential files
are today.

Agents (`agents=`) are subjects too: the CI agent sets its own credentials through the same API
with its token, and the Claude agent its own. An agent's credentials are not a person's.

## 4. What changes

**Core** (small): `Environments` gains `load(Path definitions, Path credentials)` returning the
merged view, with the credential file's keys for a name overlaying the definition's and names only
in the credential file taken whole. `Environments.load()` with no argument stays for the CLI.
`SecretSource.warnIfShared` runs on both files.

**Web server**:

- `Workspace.open(...)` takes the person's environments file; `VaultService`, `CredentialService`,
  `EventsService` and `SetupService` hold the paths they were opened with and never call the
  no-argument `load()`. The `IDM_ENVIRONMENTS` warning in `Serve.hosted` goes.
- `CredentialService` splits: *definitions* (list for everyone; add, change, remove for deployers,
  audited) and *my credentials* (the signed-in person only: set bind DN and password source, test
  the bind, remove). Driver secrets stay as they are, deployer-only, in the shared directory.
  Nothing ever returns a value; reads describe the kind of source, as today.
- `TraceFiles` moves to `users/<subject>/traces/<project>`.
- A `UserData` helper: resolve and create `users/<subject>`, write `profile.properties` at sign-in,
  list subjects with their profiles for the admin's view (later).
- Hosted keys: `environments.file` is read once more at start; if it holds password keys the
  server refuses to start and says which keys to move (so an upgrade cannot silently keep a shared
  password). `secrets.dir` (default `data.dir/environments`) names where the driver secrets live.

**Page**:

- **Connections** becomes two panels: *Environments* (the project's definitions; deployers edit)
  and *My connections* (one row per environment: connected / not connected, bind DN, password
  source, *Test*, *Set up…*, *Forget*). The project's `environments=` list still says which names
  this tree is deployed to.
- Every view that lists environments shows the person's effective ones; an environment without a
  credential is shown greyed with "set up your connection".
- **Trace files** lists only the person's own.

**Local mode** is one person and is unchanged: one file, every key, as the CLI reads it.

## 5. Migration

- On first start after the change the server reads today's `environments.file`: entries' password
  keys are *not* copied anywhere; the file is rewritten as `definitions.properties` without them,
  and the old file is left in place renamed `.before-per-user`. The operator tells each person to
  set up their connection, or does it for the lab's test accounts.
- Driver secrets files move to `secrets.dir` unchanged.
- Existing `traces/<project>` recordings cannot be attributed to a person; they are left where they
  are, read-only, under a *Shared (before per-user)* heading until someone deletes them, or the
  operator removes the directory.
- The lab has orphan workspace directories from before project names were part of the path
  (`workspaces/agent_claude`, `workspaces/<uuid>`); the upgrade removes directories that no
  project claims.

## 6. Not in this change

- An admin view of people and their last sign-in (`profile.properties` makes it possible).
- Server-side user settings (the chosen environment stays in the browser).
- Encrypting the credential files at rest. The password of record for production should be a
  secret-manager reference, not a value; the server's own cloud identity runs the manager
  commands, and that identity is shared by nature. Say so in `security.md`.
- Removing a person's directory when they leave (an admin operation, later).

## 7. Decisions (taken 2026-10-08)

1. **Definitions + per-person credentials** (section 2): the project's definitions hold no
   secrets; each person's file holds their bind DN and password source per environment name.
2. **Driver secrets are shared** per environment, deployer-only, in `secrets.dir`.
3. **Agents hold their own credentials**, like a person.
4. **The server refuses to start** when the shared definitions file still holds a password key,
   naming the keys to move.

## 8. Phases

| Phase | What | Needs |
|---|---|---|
| U1 | core: `Environments.load(definitions, credentials)`; web services take explicit paths; `IDM_ENVIRONMENTS` no longer used in hosted mode | core release |
| U2 | `UserData`, per-person credential files, the split Connections view, migration | U1 |
| U3 | traces per person; orphan workspace cleanup | U2 |
| U4 | definitions editing by deployers in the page | U2 |

## 9. As built (U2)

- `environments.file` keeps its name and becomes the **definitions** file; the server refuses to
  start while it holds a secret key (`Environments.secretKeys`), naming them. The driver secrets
  stay **beside it** (`secrets-<env>.properties` in the same directory), so an existing install
  moves nothing; `secrets.dir` was not added.
- `data.dir/users/<subject>/` (`UserData`, `0700`): `environments.properties` (the person's
  credentials: `bindDn`, `password…`, `trustAll`, or whole environments of their own) and
  `profile.properties` (subject, name, email, last seen). Created on first use; the profile is
  touched whenever their environments are opened.
- `CredentialService` with two files: `list` marks each environment `defined`, `own`,
  `connected`; `save` (deployers, `/api/credentials/environment`) writes the definition fields
  only and refuses a password; `saveMine` / `removeMine` (`/api/credentials/mine`,
  `/api/credentials/mine/remove`, any signed-in role) write the person's file, and for a name the
  project does not define take the definition fields too. Driver secrets and `<env>.secrets`
  stay in the definitions, deployer-only.
- **U3:** trace recordings and uploads are the person's: `users/<subject>/traces/<project>/`.
  Recordings from before (`data.dir/traces/<project>/`) are not attributed; the server lists
  such directories at start-up (with `workspaces/<x>` of no project) as a NOTICE and never removes
  them — the operator moves a recording under the person who made it, or deletes it.
- **U4:** the definition form holds everything a definition can: URL, driver set, tier,
  `requires`, SSH host and user, and the event store (`eventsUrl`, `eventsUser`, `eventsTable`,
  `eventsPseudonymise`, `eventsTree`); the person's connection holds the bind DN, trust, the
  vault password and the event store's reader password (`eventsPassword…`), each from a file, a
  variable, a command or a manager. The environment pickers (Vault, Schema, App schema, Events,
  Trace) mark an environment the project defines but the person has not connected to with *set up
  your connection*, linking to Connections; `GET /api/vault/environments` carries `split`,
  `defined`, `connected`, `own`.
