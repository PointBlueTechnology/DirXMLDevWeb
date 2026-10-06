# DirXMLDevWeb

A browser workbench for NetIQ / OpenText Identity Manager driver sets, over the
[DirXMLDev](https://github.com/PointBlueTechnology/DirXMLDev) core. It runs on your workstation:
one command serves a page for one IDM-as-code tree.

Status: **W2** (unreleased). Reading a tree, editing its configuration and editing policies
structurally are in place; the vault features and the simulator follow. See
[docs/design.md](docs/design.md) for the phases.

## What it is, and is not

It is a third client of the DirXMLDev core, next to the `idm` CLI and the MCP server. The page
calls the same typed operations they call, so anything the core can do, it can do, with the
same validation and the same refusals. It is not a port of Designer and contains no OpenText
code. The tree on disk (in git) is the only state: edit here, with the CLI or with an agent, and
the page follows the files.

## What it does

- **Outline** of the driver set: Library, drivers, policies by channel, configuration files,
  entitlements, forms, PRDs.
- **Policy flow**: the fishbone the VS Code extension draws, from the same model. Click a policy
  to open it.
- **Policy editor in two modes** (W2). *Rules* is a structured editor for a DirXML Script
  policy: rules, condition groups, actions, arguments and tokens, with every element of the
  language available and each node's attributes, order and nesting taken from the grammar.
  *Source* is the XML. Both edit one draft. A pause in editing sends the draft through the
  engine's compiler and the rest of validation, so a mistake is named while it is on screen.
- **Entitlements**: Designer's editor — display name, description, conflict resolution,
  multi-valued, and the values: none (the requester's), a static list of the connected system's
  keys (as an association holds them — GUIDs, ids, names, DNs), or a query against the
  application shown as what it asks and returns; the query itself and anything else are edited
  in the XML tab.
- **References**: what links to, includes or maps through an artifact.
- **Validation**: the core's whole check suite, including the engine's own compiler.
- **Configuration editors** (W1), per driver and for the driver set:
  - *GCVs* in scope, each from the place the engine would take it, with a column per environment
    for the values that differ per stage.
  - *Settings*: shim class and authentication, shim parameters, engine control values.
  - *Filter*: classes and attributes with each channel's setting and the merge authority.
  - *Policy sets*: every set as an ordered list; drag or use the arrows to reorder, link, unlink.
  - *Schema map* and *mapping table* as their own structured tab on the artifact.
  - *Stage overrides*: every environment's values in one matrix beside the base.
  - Configuration files and entitlement definitions are also editable as XML.
- **One review for every write.** An editor collects its changes; Review runs them against a
  throwaway copy of the tree and shows each file before and after with the core's verdict;
  Apply writes them as one transaction, or nothing.
- **Operations**: every edit operation the core registers with a form generated from its
  declared arguments, through the same review.
- **Vault** (W3), against any environment the `idm` CLI knows:
  - *Compare*: the tree against the vault, for the driver set or one driver, with the stage's
    overrides applied; each difference opens its detail.
  - *Deploy*: the plan step by step with nothing written, then the deploy itself (snapshot,
    write, restart, verify) once you type the environment's name.
  - *Drivers*: every driver's state, start option and cache; start, stop and restart behind
    the same typed confirmation.
  - *Trace*: a driver's trace, live, with a filter.
- **Provisioning** (W5), for the User Application driver:
  - *PRD*: the workflow drawn as a diagram from the core's flow model. Select an activity to
    change its name, form, addressee and timeout, its links out (add, retype, remove), its data
    items, to insert an activity after it, rename or remove it; the process attributes and the
    forms the PRD binds are on the Details tab. Every change is a `flow.*` operation, reviewed.
  - *Form*: the components as a list (label, required, hidden, order, add, remove through
    `form.field.*`), the document as JSON (saved whole through `form.set-content`), and the
    PRD activities that show it.
  - *Roles and resources*: the catalog, with display names and descriptions editable, add and
    remove, through `role.*` and `resource.*`.
- **Packages** (W6): what each driver and the Library have installed against the catalog, with
  upgrades the catalog offers, customized packaged objects (revert) and missing records
  (adopt); install, upgrade and uninstall through the review; the catalog's packages; a
  package built from a driver into the catalog.
- **Simulator** (W4): a corpus of cases run through the tree's policies by the engine's own
  classes.
  - *Run all* gives each case its verdict against what it recorded, as `idm simulate` does.
  - A case opens *stage by stage*: the document before and after every policy, as a diff, with
    that policy's trace, queries and commands.
  - Edit the input and *run without saving*; record the output a case should keep producing.
  - Run with a stage's override values, and compare the result with another stage's.
- **Connections**: the environments the `idm` CLI reads, set up from the page — vault URL, bind
  DN, driver set, tier, trust, SSH host — with a connection test before saving; the password
  and each driver secret a deploy needs (shim, Remote Loader, named passwords, read off the
  tree) typed once and kept in the macOS Keychain or an owner-only file, never shown again.
- **Secret managers**: a password or driver secret can be a *reference* instead of a stored
  value — AWS Secrets Manager, Azure Key Vault, Google Cloud Secret Manager, CyberArk CCP,
  BeyondTrust Password Safe, Bitwarden (`bw`, for a workstation) and Bitwarden Secrets Manager
  (`bws`), a Terraform output, or any command. The page builds the command, tests that it yields
  a value, and saves only the command (the core's `…Command=` form); the value is read when
  needed, on the host that runs the server, and never shown. See "Secret managers" below.
- **Live follow**: any change to the tree, by anything, reloads the page within a second.

## Run it

Prerequisites: a built [DirXMLDev](https://github.com/PointBlueTechnology/DirXMLDev) 0.8.0 or
newer (its `bin/idm doctor` is green), JDK 21, Maven 3.9, Node 20 or newer.

```bash
# once, in the DirXMLDev checkout: make its jar available to this build
mvn -o install -DskipTests
```

```bash
# once, in this checkout: the server and the page
mvn -o package
```

```bash
cd web && npm ci && npm run build
```

```bash
# serve a tree (import one with `idm import-live`, `import` or `import-ldif`)
bin/idmweb serve /path/to/tree
```

The build also needs `dirxml-simulator` in `~/.m2` (`mvn install` in DirXMLSimulator), which a
built DirXMLDev already has. Simulator cases are read from `cases/` beside the tree; name
another place with `--cases DIR`. The package catalog is `--catalog DIR` (or `IDM_CATALOG`);
without one, installed packages are still listed from the tree but nothing can be installed,
upgraded or built.

The server prints a URL and opens it. DirXMLDev is found at `IDM_HOME`, else at `../DirXMLDev`.
The server runs on that checkout's own classes, engine jars and simulator, so the page sees
exactly what `bin/idm` sees.

## Hosted mode

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
data.dir=/var/lib/idmweb                # workspaces, audit.log
repo.url=https://github.com/org/idm-config.git
repo.tokenKeychain=idm-repo/token       # or repo.token, .tokenEnv, .tokenCommand
repo.base=main
repo.tree=tree                          # the tree's directory inside the repository
repo.cases=cases
catalog.dir=/srv/idm/catalog
environments.file=/etc/idmweb/environments.properties
identity=none                           # none (loopback only, for a trusted host) or oidc
none.users=alice:Alice:alice@example.com:idm-editors;bob:Bob:bob@example.com:idm-deployers
roles.editor=idm-editors,idm-deployers
roles.deployer=idm-deployers
session.hours=8
```

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
[hosted/keycloak](hosted/keycloak/README.md) has a ready realm. `bin/smoke-hosted.sh` walks the
whole loop with the `none` provider against a local bare repository; `bin/smoke-oidc.sh` does it
through a real Keycloak in Docker.

The **container** ([docs/hosted-install.md](docs/hosted-install.md)): `hosted/docker/build.sh`
builds an image with the server, the page and the `idm` CLI on a JRE with git; the engine jars
are mounted, never shipped. `hosted/docker/compose.yml` runs it behind Caddy (TLS) with Keycloak.
**Agents** (CI, an MCP server) use the same server with `Authorization: Bearer <token>` from
`agents=`, or the CLI with `docker exec idmweb idm …`; `bin/smoke-container.sh` proves the image.

## Security model

- The server binds to loopback only.
- The URL carries a one-time session token in its fragment. The page moves it to session
  storage and sends it as a header; every API request without it is refused.
- Requests naming another host (DNS rebinding) or coming from another origin are refused.
- Files are served only from inside the tree; `.git` and deploy snapshots are not content.
- A write quotes the tree revision it was planned against and is refused if the tree moved.
- Vault access uses the environments file and credential sources of the `idm` CLI
  (`IDM_ENVIRONMENTS`, `./environments.properties`, `~/.idm/environments.properties`). The page
  is told an environment's name and tier, never a URL, bind DN or secret.
- A password or driver secret typed into the Connections view crosses the loopback connection
  once and is stored where you chose: the macOS Keychain (`<env>.passwordKeychain`,
  `<key>Keychain`) or the owner-only environments / secrets file as a literal; or the page
  records a command, environment variable or secret-manager reference to read it from. Reads
  describe each credential by the kind of its source only; no response, log or diff carries a
  value.
- Nothing is read from a vault until you choose an environment and ask. Every write to a vault
  (deploy, driver start, stop, restart) needs that environment's name typed into the page; the
  server checks it, and `IDM_AGENT_ALLOW_WRITE` does not stand in for it here.

## Layout

```
bin/idmweb        launcher (runs on DirXMLDev's class path)
bin/smoke.sh      end-to-end check against a scratch tree
src/main/java     the server: Serve, Api, TreeService, Watcher, Security, StaticFiles
web/              the page: TypeScript, React, Monaco
docs/design.md    assessment and design; phases W0–W7
```

## Tests

```bash
mvn -o test            # server unit tests
```

```bash
cd web && npm test     # page unit tests
```

```bash
bin/smoke.sh           # every endpoint, the security gates and the write path, on a real tree
```

## Secret managers

A credential in the environments file or a secrets file may be a command instead of a value
(`<key>Command=…`, run with `/bin/sh -c`, stdout is the value). The Connections view writes
that line for you from a preset:

| Manager | Command written | Needs |
|---|---|---|
| AWS Secrets Manager | `aws secretsmanager get-secret-value --secret-id … --query SecretString --output text` (`\| jq -r .field` for a JSON secret) | `aws` signed in |
| Azure Key Vault | `az keyvault secret show --vault-name … --name … --query value -o tsv` | `az` signed in |
| Google Cloud Secret Manager | `gcloud secrets versions access latest --secret=…` | `gcloud` signed in |
| CyberArk CCP | `bin/secrets/cyberark-ccp.sh HOST APPID SAFE OBJECT` | `curl`, `python3`; client certificate via `CCP_CERT`/`CCP_KEY`, CA via `CCP_CA` |
| BeyondTrust Password Safe | `bin/secrets/beyondtrust.sh HOST SYSTEM ACCOUNT` | `python3`; `BT_API_KEY` and `BT_RUNAS` in the server's environment |
| Bitwarden | `bw get password "item"` (or `bw get item … \| jq` for a custom field) | `bw`, unlocked: `BW_SESSION=$(bw unlock --raw)` |
| Bitwarden Secrets Manager | `bws secret get ID \| jq -r .value` | `bws`, `BWS_ACCESS_TOKEN` |
| Terraform output | `terraform -chdir=… output -raw NAME` | `terraform`; the value is in Terraform state, so prefer a manager Terraform provisions the secret into |

The command runs on the host that runs the server (your workstation in local mode), with the
environment of the shell that started it: export `BW_SESSION`, `BT_API_KEY`, cloud profiles and
the like there. Keys a manager needs (an API key, a session) are themselves credentials: keep
them in the Keychain and export them from it, e.g. `BT_API_KEY=$(security find-generic-password
-s beyondtrust -w)`. The same lines work for the `idm` CLI, which reads the same files.

**With Terraform**: have Terraform provision the secret into the manager (`aws_secretsmanager_secret_version`,
`azurerm_key_vault_secret`, `google_secret_manager_secret_version`, …) and reference it from
here by name; nothing is copied, and a rotation in Terraform is picked up on the next read. A
Terraform module that writes the environments and secrets files and runs `idm vault.deploy` is
a follow-up (docs/design.md).

## Known limits

- The structured policy editor covers DirXML Script. XSLT and ECMAScript are edited as source.
- The editor's grammar table (`web/src/policy/grammar.json`) is generated from the DirXML Script
  DTD that ships with Designer by `tools/dtd2grammar.py`; regenerate it for a newer DTD.
- The PRD and form editors cover the common settings; an activity's REST, role-request,
  resource-request and notification settings, a form field's other properties and owners,
  approvers and other languages of a role go through Operations (`flow.activity.set`,
  `form.field.set --prop`, `role.set`). Branches are inserted with `flow.branch.add` there.
- Packages with prompts take their answers file through Operations → package.install;
  `package.fetch` and `package.import` fill the catalog from the CLI.
- With a DirXMLDev older than 0.8.0 the stage-override and whole-document configuration
  controls are hidden or read-only, and flow edits fail.
- A setting cannot be cleared to empty from the Settings tab; do that in the document's XML.
- Deploy from the page covers the common case. Secrets, deleting a driver, drift capture,
  stepwise deploys and rollback stay with `idm vault.deploy` and `idm vault.rollback`; a deploy's
  result names its snapshot.
- The trace view reads over the environment's LDAPS connection and keeps the last 5,000 lines.
- The simulator view creates plain cases (a driver, a channel, an input document). A case's
  other keys (schema, a fake directory, assertions, a live query source) are honoured when run
  but are edited in its files; comparing with another tree stays with `idm simulate --against`.
- Cases are kept in `cases/` beside the tree (or `--cases DIR`). They are not part of the
  tree's revision: the page reloads them after its own writes.
- Hosted sessions live in memory: a restart signs everyone out. Pull requests are a link to the
  provider's compare page; creating them through an API is a follow-up.
