# Hosted mode: configuration

`serve --hosted` is what both the local (one person) and the server (team) installs run: sign-in,
projects, a branch per person as a workspace, commits and pushes from the page, the vault
credentials held by the server, an audit line per action. This page is the configuration
reference for both; [quickstart.md](quickstart.md) sets it up for one person on localhost
(`identity=token`), [hosted-install.md](hosted-install.md) for a team on a host
(`identity=oidc`), [hosted.md](hosted.md) is the design.

`bin/idmweb serve --hosted hosted.properties` runs the same server for a team: people sign in,
each opens a **branch** of the team's git repository as a workspace of their own (a checkout
under the server's data directory, cloned on first use), edits it with every view above, and
commits and pushes from the bar at the top; a pull request is one click away on GitHub or
GitLab. The server holds the vault credentials (its environments file and secrets files, the
same ones the CLI reads) and writes an audit line per sign-in, write, deploy, driver action,
trace, commit and push. Roles come from groups: *editors* read, edit and commit; *deployers*
also deploy, control drivers, trace and change connections.

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
repo.tokenKeychain=idm-repo/token       # a token for https remotes (project.<name>.repo.token for one project's own)
catalog.dir=/srv/idm/catalog
environments.file=/etc/idmweb/environments.properties   # the project's environment DEFINITIONS: no password keys (the server refuses to start with one); each person's bind DN and password live under data.dir/users/<subject>/ — docs/multi-user.md
project.<name>.environments=edir3,edir3-prd   # optional: the environments (names from that file) this project's tree is deployed to; without it, every environment is offered
identity=none                           # none (loopback only, for a trusted host) or oidc
none.users=alice:Alice:alice@example.com:idm-editors;bob:Bob:bob@example.com:idm-deployers
roles.editor=idm-editors,idm-deployers
roles.deployer=idm-deployers
session.hours=8                         # 0: never (the one-person install); sessions survive a restart
setup.roots=/srv,/var/lib/idmweb      # where path-based setup may point (default: data.dir and /srv)
```

**Roles and the host.** An *editor* reads, edits, commits and pushes, and adds a project by
uploading a Designer project or export, exporting from a vault, or cloning a remote. Attaching a
path of the host — a checkout in place, a bare repository, a directory of files — and typing a
command to test a secret manager are the *deployer's*: both act on the server as its own user.
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
oidc.clientSecretKeychain=idmweb/oidc           # or .clientSecret, .clientSecretEnv, .clientSecretCommand
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
