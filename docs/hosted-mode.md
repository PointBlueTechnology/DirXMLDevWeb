# Hosted mode: configuration

`serve --hosted` is what both the local (one person) and the server (team) installs run: sign-in,
projects, a branch per person as a workspace, commits and pushes from the page, each person's
vault credentials in their own file on the server, an audit line per action. The workstation
install (`serve <tree>`, local mode) has none of this; docs/security.md sets the two modes side by
side. This page is the configuration
reference for both; [quickstart.md](quickstart.md) sets it up for one person on localhost
(`identity=token`), [hosted-install.md](hosted-install.md) for a team on a host
(`identity=oidc`), [hosted.md](hosted.md) is the design.

`bin/idmweb serve --hosted hosted.properties` runs the same server for a team: people sign in,
each opens a **branch** of the team's git repository as a workspace of their own (a checkout
under the server's data directory, cloned on first use), edits it with every view above, and
commits and pushes from the bar at the top, and creates the pull request (GitHub) or merge
request (GitLab) from there too (docs/pull-requests.md); a repository with neither in front of it
(one the server made, or plain git) is merged with **Merge into main…** on the bar. Production
deploys come from the base branch only, as the repository holds it. The server holds the environment
definitions (`environments.file`, no secrets) with the driver secrets beside them, and each
person's bind DN and password in their own file under `data.dir/users/<subject>/`
(docs/multi-user.md); it writes an audit line per sign-in, write, deploy, driver action, trace
change, commit and push. Roles come from groups: *readers* look; *editors* read, edit and commit;
*deployers* also deploy, control drivers, set trace levels and read the engine's trace file, and
change the shared environments and driver secrets. Watching a live trace is open to anyone
signed in.

```properties
public.url=https://idm.example.com      # what the browser sees; TLS terminates at a reverse proxy
bind=127.0.0.1                          # the proxy's side (0.0.0.0 in a container)
port=8080
data.dir=/var/lib/idmweb                # workspaces, users/<subject>/ (credentials, traces), audit.log
projects=idm-lab,customer-a             # the trees this server holds (the single repo.* keys still work for one)
project.idm-lab.repo.url=https://github.com/org/idm-config.git
project.idm-lab.repo.tree=tree          # the tree's directory inside the repository
project.idm-lab.repo.cases=cases
project.idm-lab.repo.base=main
project.customer-a.repo.inPlace=/srv/customer-a   # a checkout used in place instead
repo.tokenEnv=IDMWEB_REPO_TOKEN         # a token for https remotes (project.<name>.repo.token for one project's own); .tokenKeychain on a macOS host only, never in the container
# pull requests (#35): the provider and its API when the remote does not say (github.com and hosts named
# "gitlab" are recognised); the token above creates them, so give it pull-request write (GitHub) or api (GitLab)
#repo.provider=github                   # github | gitlab (project.<name>.repo.provider for one project)
#repo.apiUrl=https://git.example.com/api/v3
#repo.caFile=/etc/idmweb/git-ca.crt     # a self-hosted provider's private CA (else oidc.caFile)
catalog.dir=/srv/idm/catalog
environments.file=/etc/idmweb/environments.properties   # the project's environment DEFINITIONS: no password keys (the server refuses to start with one); each person's bind DN and password live under data.dir/users/<subject>/ — docs/multi-user.md
project.<name>.environments=edir3,edir3-prd   # optional: the environments (names from that file) this project's tree is deployed to; without it, every environment is offered
identity=none                           # token (one person: token.valueEnv, token.user), oidc (a team), or none (tests; loopback only)
none.users=alice:Alice:alice@example.com:idm-editors;bob:Bob:bob@example.com:idm-deployers
roles.editor=idm-editors,idm-deployers
roles.deployer=idm-deployers
session.hours=8                         # 0: never (the one-person install); sessions survive a restart
setup.roots=/srv,/var/lib/idmweb      # where path-based setup may point (default: data.dir and /srv)
```

**Roles and the host.** An *editor* reads, edits, commits and pushes, and adds a project by
uploading a Designer project or export, exporting from a vault, or cloning a remote. Attaching a
path of the host — a checkout in place, a bare repository, a directory of files — typing a
command to test a secret manager, and keeping one's own password or Git token as a reference
(an environment variable, a command, a secret manager or the Keychain) are the *deployer's*: the
server resolves a reference as its own user. An editor keeps the value itself in their own file
(docs/security.md).
Paths must lie under `setup.roots`. A token typed for a clone is never written into this file: it
goes to `<data.dir>/secrets/<project>.repo.token` (owner-only) and the configuration references it
as `project.<name>.repo.tokenCommand`. A project used in place is one person's working copy: the
first to open it holds it, others are refused and should branch from a repository instead.

The session is an `HttpOnly; SameSite=Strict` cookie (`Secure` behind https); every write
carries the session's CSRF token; requests must address `public.url`'s host.

`identity=oidc` signs people in with OpenID Connect — discovery, the authorization-code flow
with PKCE, the ID token verified here (RS256/384/512, ES256 against the provider's JWKS, issuer,
audience, expiry, nonce), groups from `oidc.groupsClaim` (a dotted path such as
`realm_access.roles`; the userinfo endpoint is consulted when the token lacks it):

```properties
identity=oidc
oidc.issuer=https://login.example.com/realms/idm
oidc.clientId=idmweb
oidc.clientSecretEnv=IDMWEB_OIDC_SECRET         # or .clientSecret, .clientSecretCommand; .clientSecretKeychain on a macOS host only
oidc.groupsClaim=groups
oidc.scopes=openid profile email
```

Register the client as confidential with redirect URI `<public.url>/auth/callback`;
[hosted/keycloak](../hosted/keycloak/README.md) has a ready realm. `bin/smoke-hosted.sh` walks the
whole loop with the `none` provider against a local bare repository; `bin/smoke-oidc.sh` does it
through a real Keycloak in Docker.

**One person, one container**: `hosted/docker/single-user/setup.sh <tree>` gives a single
person the web UI, the `idm` CLI and the simulator in a local container with one token, a
bare repository in the directory, the engine jars from a volume, and a token for their agents
([hosted/docker/single-user](../hosted/docker/single-user/README.md)).

The **container** ([docs/hosted-install.md](hosted-install.md)): `hosted/docker/build.sh`
builds an image with the server, the page and the `idm` CLI on a JRE with git; the engine jars
are mounted, never shipped. `hosted/docker/compose.yml` runs it behind Caddy (TLS) with Keycloak.
**Agents** (CI, an MCP server) use the same server with `Authorization: Bearer <token>` from
`agents=`, or the CLI with `docker exec idmweb idm …`; `bin/smoke-container.sh` proves the image.

## A project's repository: moving it to GitHub or GitLab

A project made on the page pushes to a repository this server created, `data/projects/<name>.git`.
This happens when the project comes from a vault export, an upload, or a directory. Open
**Projects → Repository** to see where any project pushes, its base branch and whether it has a
token, and to keep your own Git token for pull requests.

A deployer moves a project to a remote of its own with **Push this project to a remote…**:
1. Give the remote's address and a token that can push.
2. Choose **Check**. It confirms the remote is empty, or already holds exactly this history, and
   lists each workspace's work that isn't pushed yet.
3. Type the project's name and choose **Move**:
   - every branch and tag is copied, and the copy is verified;
   - the project, and every workspace's `origin`, switch to the remote, with no restart;
   - the old repository is kept as `<name>.git.moved-<date>`.

Unpushed work isn't lost: each workspace now pushes to the remote. For a remote that moved (a
renamed organization, a new host), **Change remote…** checks the new address holds the base branch,
then switches the same way. Both are recorded in the audit log.

## Archiving and removing a project

Deployers, from **Projects** in the sidebar (or `POST /api/setup/archive` and `/api/setup/remove`).

- **Archive** puts a project away without losing anything: its repository is written as a git
  bundle (`git bundle create … --all`: the complete history, every branch and tag; a remote is
  mirrored first), then everything the server holds for it moves into
  `data.dir/archive/<project>-<yyyymmdd-hhmmss>/` — `workspaces/`, every person's `traces/<subject>/`,
  a repository the server made for it (`<project>.git`), its token file — and the project leaves
  `hosted.properties`. `archive.properties` in that directory says what, when, by whom. The bundle
  downloads from the Projects view (`GET /api/setup/archive/file?name=…`); `git clone <bundle>`
  restores the repository anywhere. The directory stays until the operator removes it; the
  server never deletes an archive.
- **Remove** only forgets the project: its workspaces, recordings and a server-made repository
  stay on disk (the start-up NOTICE names them). Use it when the repository lives elsewhere and
  nothing on this server matters.

Both are audited (`project.archive`, `project.remove`).
