# Security model

The server runs in two modes, and several of the rules below differ between them. The README's
*Three ways to run it* names the installs: the **workstation** install (`bin/idmweb serve <tree>`
from a checkout) is the server's *local mode*; the **local container** (one person,
`http://localhost:8080`) and the **team server** are both *hosted mode* (`serve --hosted`), one
configured for one person and one for a team.

| | Workstation (local mode) | Local container and team server (hosted mode) |
|---|---|---|
| Listens on | loopback only | `bind=` in `hosted.properties` (default `127.0.0.1`; `0.0.0.0` inside the container, published on the host's loopback by the local container's compose file, behind a TLS proxy for a team) |
| Sign-in | none: the URL carries a one-time token in its fragment; the page moves it to session storage and sends it as `X-IDMWeb-Token` on every request | `identity=` `token` (the local container: one token, yours), `oidc` (a team: your identity provider) or `none` (tests; refused unless bound to loopback). A session is an `idmweb_session` cookie (`HttpOnly; SameSite=Strict`, `Secure` when `public.url` is https), kept in `data.dir/sessions.json` across restarts; a write also carries `X-IDMWeb-CSRF`. An agent sends `Authorization: Bearer <token>` (no cookie, no CSRF header) |
| Host and Origin | `127.0.0.1:<port>` or `localhost:<port>` | only `public.url`'s host and origin (the local container: `localhost:8080`, so `http://127.0.0.1:8080` is refused) |
| Roles | none: the one person may do everything | reader, editor, deployer (`roles.*`, docs/hosted-mode.md) |
| Vault credentials | the `idm` CLI's environments file (`IDM_ENVIRONMENTS`, `./environments.properties`, `~/.idm/environments.properties`), secrets included | the project's definitions in `environments.file` (no secrets; the server will not start with any), each person's bind DN and password in their own `data.dir/users/<subject>/environments.properties` |
| Where a typed password is kept | the macOS Keychain, the owner-only file, or a variable, command or secret-manager reference | the person's own owner-only file; a deployer may also keep a reference (below). The Keychain is macOS only, so never in the container |
| Audit log | none | `data.dir/audit.log`, readable by deployers |
| Typed secrets cross | the loopback connection | the connection to the server: TLS only when `public.url` is https (a team server behind its proxy; the local container stays on the host's loopback) |

The rest holds in both modes unless it names one.

- Requests naming another host (DNS rebinding) or coming from another origin are refused.
- Files are served only from inside the tree; `.git` and deploy snapshots are not content.
- A write quotes the tree revision it was planned against and is refused if the tree moved.
- On a workstation, vault access uses the environments file and credential sources of the `idm`
  CLI (`IDM_ENVIRONMENTS`, `./environments.properties`, `~/.idm/environments.properties`). The
  page is told an environment's name and tier, never a URL, bind DN or secret.
- On a hosted server the environments file holds the project's definitions only; a person's
  bind DN and password source go to their own `data.dir/users/<subject>/environments.properties`
  (`0600` in a `0700` directory), reached only through their session and never listed, read or
  returned for anyone else. Driver secrets stay beside the definitions, deployer-only
  (docs/multi-user.md).
- A password or driver secret typed into the Connections view crosses the connection to the
  server once (see the table) and is stored where you chose: the macOS Keychain
  (`<env>.passwordKeychain`, `<key>Keychain`; a workstation on macOS only) or the owner-only
  environments / secrets file as a literal; or the page records a command, environment variable
  or secret-manager reference to read it from (on a hosted server, a deployer's only). Reads
  describe each credential by the kind of its source only; no response, log or diff carries a
  value.
- In hosted mode, acting on the server's host is the deployer's: attaching a path (a checkout in
  place, a repository, a directory) is deployer-only and confined to `setup.roots`; a command
  typed to test a secret manager runs only for a deployer (an editor may still resolve a saved
  credential by its key). A reference in a person's own file (their vault password, their
  event-store password, their Git provider token), whether an environment variable, a command, a
  secret manager or a Keychain item, is resolved on the server as the server: a variable reference
  could name one of the server's own variables and send it to a vault URL of the person's choosing.
  So only a deployer may save one, and one an editor saved before is kept in their file but never
  resolved: the Connections view shows it as *env (deployers only)* or *command (deployers only)*,
  opening that environment says why, and a pull request falls back to the project's token. The
  value itself in their own (owner-only) file stays open to everyone. A clone's token is kept in
  an owner-only file under the data directory, never in the configuration. A checkout used in place belongs to the person who
  opened it.
- Nothing is read from a vault until you choose an environment and ask. Every write to a vault
  (deploy, driver start, stop, restart) needs that environment's name typed into the page; the
  server checks it, and `IDM_AGENT_ALLOW_WRITE` does not stand in for it here.

## Older TLS suites

eDirectory's LDAPS listener often offers only static-RSA key exchange (`TLS_RSA_*`, for example
`AES256-GCM-SHA384`), no ECDHE and no TLS 1.3. Recent JDK builds disable those suites by default,
and the symptom is a connection test or vault bind that fails with "simple bind failed" although
the credentials are right. The server therefore keeps `TLS_RSA_*` enabled, first thing at
start-up, on every install. Those suites lack forward secrecy: when every vault you connect to
offers ECDHE, opt out with `IDM_TLS_LEGACY=false` in the container's environment
(`-Didm.tls.legacy=false` for the Java launchers).

An image from before this change gets the same effect from a `java.security` override: a file
with the JDK's `jdk.tls.disabledAlgorithms` list minus `TLS_RSA_*`, named in
`IDM_JAVA_OPTS=-Djava.security.properties=/etc/idmweb/legacy-tls.security` in `idmweb.env`.

