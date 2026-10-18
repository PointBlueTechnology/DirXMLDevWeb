# W7 — Hosted mode (design note, 2026-10-05)

Status: **decided 2026-10-05 (Keycloak, GitHub, container, proxy TLS, the server's bind, all at once); building in three steps: workspaces + git + audit (done), OIDC (done), container (done); live at https://idmweb.pointbluetech.com:8443 on DockerHost1 since 2026-10-06.**

> **As built, read this first.** This is the design as decided; later work changed several points.
> The current reference is [hosted-mode.md](hosted-mode.md) and [security.md](security.md):
> - The server is started with `serve --hosted <file>`, and identity is `token` (one person, the
>   local container), `oidc` or `none` (tests).
> - Vault credentials are per person (docs/multi-user.md): the server's environments file holds
>   definitions only; only the driver secrets are shared.
> - The roles keys are `roles.editor` and `roles.deployer`. Watching a live trace is open to
>   anyone signed in; setting trace levels and reading the engine's trace file are a deployer's.
> - The cookie is `Secure` only when `public.url` is https, and sessions persist in
>   `data.dir/sessions.json` across restarts.
> - Host and Origin are checked against `public.url`, not loopback.
> - Pull requests are created through the provider's API (docs/pull-requests.md), not only
>   linked to the compare page.
> - A server holds several **projects** (`projects=…`), each with its own repository, tree and
>   base branch. Workspaces are `workspaces/<project>/<user>/<branch>`, and a project can be a
>   checkout used in place (one person's).
> - A project can start without a repository: the server makes one (`data/projects/<project>.git`).
>   **Projects → Repository** moves it to GitHub, GitLab or any git host, or changes its address
>   (docs/connections-ui.md).
> - **The page does merge** (docs/git-workflow.md). **Merge into main…** merges a branch into the
>   base branch on the repository when it is not on GitHub or GitLab. **Get latest main**
>   brings the base into a copy of it. §3's "the page does not merge" is out of date. **Update
>   from main** still leaves a conflict to resolve with git.
> - **Conflicts are settled on the page** (since 0.67.0): Update from main, or a captured state,
>   that conflicts offers Resolve the conflicts… (docs/git-workflow.md).
> - **Production deploys come from the base branch** as the repository holds it: pushed and
>   current. A production vault can allow any branch with `<env>.fromAnyBranch=true`, for a
>   project with one environment.
> - The current guide to branches, environments and promotion is
>   [git-workflow.md](git-workflow.md).

Local mode (W0–W6) is one person, one tree on their workstation, one server on loopback with
a one-time token. Hosted mode is the same server and page for a team: it runs inside the
customer's network next to their vault, people sign in, each works on a workspace that is a
server-side clone of the team's git repository, and the server holds the vault credentials.
The design note (`design.md` §3) named four seams; this note says what each becomes, what the
page gains, and what has to be decided first.

## 1. What hosted mode adds

| | Local today | Hosted |
|---|---|---|
| Start | `bin/idmweb serve <tree>` | `bin/idmweb serve --hosted --config hosted.properties` |
| Who | the person at the keyboard | a signed-in user (OIDC); a session cookie, not a URL token |
| Tree | one directory | a **workspace** per user and branch: `workspaces/<user>/<branch>/` cloned from the team repository |
| Vault credentials | the workstation's Keychain / secrets file | the server's secrets store, per environment; the page never sees them |
| Engine jars | the workstation's `lib/` | the server's `lib/`, supplied by the customer |
| Writes | the tree on disk | the workspace on disk, then **commit, push, pull request** from the page |
| Audit | none | one line per write and per vault action: who, when, workspace, operation, outcome |

Everything else — the catalog of operations, validation, the review, compare, deploy, trace,
the simulator, provisioning, packages — is the code that exists. A hosted server with one user
and the `none` identity provider is local mode with workspaces, which is how it is tested.

## 2. Identity

- **OIDC with discovery.** The server takes an issuer URL, a client id and a client secret, reads
  `/.well-known/openid-configuration`, and runs the authorization-code flow with PKCE. Any
  provider that speaks it works (Entra ID, Okta, Keycloak, the customer's OSP). No provider SDK.
- **Session**: an `HttpOnly; Secure; SameSite=Strict` cookie holding a random id; the server keeps
  the session (subject, name, email, groups, expiry) in memory, 8 hours, renewed on use. The
  `X-IDMWeb-Token` header and the URL fragment are not used in hosted mode.
- **Authorisation**: one claim names the role. `idmweb.roles.editor` and `idmweb.roles.deployer`
  each list group names (or `*`). An editor can read and edit workspaces and commit; a deployer
  can also deploy, control drivers and trace. Nothing finer in version one.
- **CSRF**: every state-changing request carries the session's CSRF token in a header; the
  Host/Origin checks of local mode stay.
- **`none` provider** for development and tests: a configured list of users, chosen on a plain
  page, no password. Refused unless the server binds to loopback.

## 3. Workspaces

- The configuration names one git repository (`https://…/idm-config.git`) and how the server
  authenticates to it: a token in the secrets store, or a deploy key on the server. The server
  itself runs `git` (the customer's binary); nothing is reimplemented.
- A user opens a **branch**: the server clones (or fetches) into `workspaces/<user>/<branch>/`
  and the page serves that directory exactly as it serves a local tree, so every existing view
  and the tree watcher work unchanged. The tree path becomes a session attribute rather than a
  server constant: `TreeService` and friends are created per workspace and cached.
- **Commit and push** from the page: the review dialog gains "Apply and commit" with a message;
  the commit's author is the signed-in user; the push goes to the user's branch. **Pull request**
  opens the provider's compare URL (`<repo>/compare/<base>...<branch>`); creating it through an
  API is a later step and provider-specific.
- **Pull and conflicts**: "Update from `main`" runs `git merge`; a conflict is reported with the
  files and left for the person to resolve in a checkout. The page does not merge.
- Cases (`cases/`) and overrides live in the repository, so they travel with the branch.

## 4. Secrets and vault access

- One secrets store on the server: a directory of mode-600 properties files, one per
  environment, read through the core's existing `Secrets` and `Environments` — the same files
  the CLI reads today, kept on the server rather than a workstation. Optionally the Keychain
  equivalent on Linux is a file; a vault product (HashiCorp) is not in version one.
- The environments file is the server's. The page receives names and tiers only, as now.
- A deploy, driver action or trace runs as the server's bind, recorded against the user. Per-user
  vault binds (each person's own eDirectory account) are possible later through the same seam.
- The typed environment name stays the confirmation for every write; a deployer role is
  required on top.

## 5. Audit

`audit.log` in the server's data directory, one JSON line per event: time, user, workspace,
branch, event (`op`, `batch`, `deploy`, `driver`, `trace`, `commit`, `push`, `sign-in`),
arguments without file contents, outcome, revision before and after. Rotated by size. The core's
own deploy log stays as it is.

## 6. Decisions needed

1. **Identity provider** to test against first: Entra ID, Keycloak, or OSP from the lab?
   (Keycloak in a container is the fastest to prove; the lab's OSP proves the customer case.)
2. **Repository host** for the first team: GitHub (PointBlue org) or the customer's GitLab /
   Azure DevOps? It changes only the pull-request link in version one, but decides the e2e.
3. **Where it runs**: a container on the lab host (`nam-k3s`) next to edir3, or a VM? A container
   image needs the customer to mount `lib/`; the image never carries the engine jars.
4. **TLS**: terminate at a reverse proxy (recommended; the server stays plain HTTP on a private
   port) or in the JDK server with a keystore?
5. **Per-user vault binds** in version one, or the server's bind with the audit line?
6. **Scope of version one**: everything above, or workspaces + commit first and OIDC second
   (the `none` provider lets a single trusted host run meanwhile)?

## 7. Build order (once decided)

1. Workspaces behind the existing token (no OIDC yet): per-session tree, clone, branch, commit,
   push, compare link; audit. Smoke with a local bare repository. — about the size of W3.
2. OIDC + roles + CSRF + the `none` provider; the sign-in page. — about the size of W1.
3. Container image, reverse-proxy example, `docs/hosted-install.md`; live on the lab.
4. Pull requests through the provider's API; per-user binds — later.
