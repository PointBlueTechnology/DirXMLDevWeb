# Changelog

All notable changes to DirXMLDevWeb are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The hosted image is published to a registry and the lab pulls it (Harbor:
  `harbor.pointbluetech.com/dirxmldev/dirxml-dev-web:<version>`, multi-arch amd64+arm64), instead
  of being built on the lab host from a tarball. `hosted/docker/build.sh` pushes with buildx when
  `PUSH=1` (`ALSO_TAG=latest`), refuses to build if an engine or driver jar reached the image
  context, and copies the jars the poms name; `hosted/docker/push-on-host.sh` does the same from a
  Linux host for a registry a Mac cannot trust. When the project goes public the same image goes
  to GHCR (`ghcr.io/pointbluetechnology/dirxml-dev-web`) — a registry name, nothing else changes.

## [0.11.0] - 2026-10-06

### Added

- Validation: the counts (errors, warnings, info) are always in the top bar; the findings list is
  optional (hide ▸ / the "Validation" word), and clicking a count opens the list filtered to that
  severity. The list groups findings by the module they occur in (each driver, the Library, the
  driver set; modules with errors first), each group folds, and the severity pills at its top
  toggle what it shows. Both choices are remembered per browser.
- Repository bar: uncommitted files show as an amber "● N uncommitted files" pill and unpushed
  commits as "↑ N to push", instead of muted text.

## [0.10.0] - 2026-10-06

### Fixed

- Home: a driver card's shim class ran past the card; it is one line with an ellipsis (hover for
  the whole name).
- `hosted/docker/build.sh` takes the jars the poms name, not the newest files in `target/` — a
  rebuild of an older core had put core 0.10.0 into the 0.9.1 lab image.
- Policy flow: "Command Transformation" overran its box, and its policy stacks overlapped the
  Input/Output Transformation stacks (the boxes touched). Set boxes are 170 wide on ribs 180
  apart now, with a gutter before the Input/Output column.

## [0.9.1] - 2026-10-06

### Fixed

- The server announced itself as 0.8.1 in 0.9.0 (`Serve.VERSION` was not bumped); a test now pins it to the pom.

## [0.9.0] - 2026-10-06

Needs DirXMLDev 0.11.0.

### Added

- New menus cover every kind: a mapping table, ECMAScript resource and GCV resource on a driver
  and on the Library (the Library is always listed), an entity on the User Application driver,
  and role / resource entries that open the Roles view. ECMAScript and GCV resources are linked
  into the driver's set on creation.
- A new policy starts linked into the channel's first policy set (choose another, or none), at a
  position: first, last, before or after any policy already there.
- Policy flow: hovering a policy shows its description (and its kind); clicking a policy set opens
  it beside the picture to reorder (▲ ▼), unlink, or link an existing policy or resource — one
  reviewed change (`policy.reorder` / `policy.link` / `policy.unlink`).
- GCVs: a "Used by" column names every policy and configuration document that reads the GCV
  (click to open).
- Packages → Update sites: browse a package repository (the catalog's `sites.properties`, or any
  update-site URL) against the catalog, fetch chosen packages or every newer version of what the
  tree has installed; the Installed tab then offers the upgrade. `GET /api/packages/sites`,
  `GET /api/packages/site?site=`, `POST /api/packages/fetch`.

## [0.8.1] - 2026-10-06

### Fixed

- No way back from a file opened from another view: the selection now lives in the address
  (`#type=file&file=…`), so the browser's Back and Forward move between views, a reload keeps
  the place and a link can be shared; the file view has a "← back" link.

## [0.8.0] - 2026-10-06

### Added

- Driver set view: DN, servers (primary marked), drivers, Library, driver-set-level linkage,
  recorded packages, env overrides and files on an Overview tab; the GCV editor as a tab.
- Trace from any server of the driver set: the servers are read from the vault
  (`GET /api/vault/servers?env=`) and the stream opens at the chosen server's own address.

### Changed

- "Stage overrides" is "Env overrides" everywhere.

## [0.7.0] - 2026-10-06

### Added

- Changes view: the changed files with both sides, since the last commit, against the base
  branch on the remote (what a pull request would carry), or against upstream (what is not
  pushed); reached from the counts in the repository bar. `GET /api/git/diff?against=`.

### Changed

- Forms and PRDs are shown and offered only on the User Application driver, recognised by its
  shim class (`com.novell.idm.driver.ComposerDriverShim`), not its name.

- "Export from an Identity Vault" lists the driver sets the vault holds (name, driver count,
  the connection's own preselected) and reads the chosen one; `GET /api/setup/driversets?env=`.

### Fixed

- Adding a project to a server configured with the single `repo.*` keys dropped the first
  project from the file; every project is written when one is saved.

## [0.6.1] - 2026-10-06

### Fixed

- "Add a project" → "add or edit a connection" did nothing: the Connections view now opens
  inside the add-project flow with a way back, and the "Open a branch" block no longer shows
  underneath it.

## [0.6.0] - 2026-10-06

### Added

- Projects: one hosted server holds any number of trees (`projects=` with `project.<name>.repo.*`;
  the single `repo.*` keys still describe one). A project picker in the repository bar, "add a
  project…" through the setup ways, workspaces under `workspaces/<project>/<user>/<branch>`,
  `/api/workspaces?project=`, `POST /api/workspaces/open {project, branch}`, `POST /api/setup/remove`.

- First-run setup for a hosted server without a repository: export from a vault, import a
  Designer project (zip upload or a directory) or export, use an existing repository (bare,
  cloned per branch; or a checkout used in place), use a plain directory of files, or clone a
  remote; the choice is written to the configuration. `GET /api/setup`, `POST /api/setup/*`;
  the Connections view works before a workspace exists.
- "+ New" in the outline: policy (with policy-set linking), entitlement, form, PRD from a
  template, and a new driver (base package, copy, or shim class), each through the review and
  opening the new thing afterwards.

- One person, one container: `hosted/docker/single-user/setup.sh <tree>` builds or takes the
  image, makes a bare repository from the tree, copies the engine jars into the `lib` volume,
  mints a sign-in token and an agent token, writes the configuration, starts the container as
  the host user and prints the URL; `~/idmweb/idm …` runs the CLI and the simulator inside it.
- `identity=token`: one shared secret as the sign-in for a trusted single-user host.

## [0.5.0] - 2026-10-06

### Added

- Entitlement editor: display name, description, conflict resolution, multi-valued, and the
  values switchable between the requester's, a fixed list, and a query against the application
  (class, scope, search classes, attributes, result tokens); the XML tab for the rest.

### Changed

- Hosted mode's branch picker is a list of the repository's branches with a "new branch…" entry.

### Fixed

- A file argument (`entitlement.set --definition-file`, `form.set-content`) was deleted before an
  operation that reads it at apply time ran; it now lives until the transaction has finished.

## [0.4.0] - 2026-10-06

Hosted mode (W7): a team on one repository, with sign-in, workspaces, commit and push, roles,
an audit log, the container, and agents. Live on the Point Blue lab.

### Added

- Hosted mode, step 3: the container (`hosted/docker/`: image with the server, page and `idm`
  CLI; compose with Caddy and Keycloak; `build.sh`), agent bearer tokens (`agents=`,
  `agent.<name>.token*`) for non-browser callers, `docs/hosted-install.md`,
  `bin/smoke-container.sh`.

- Hosted mode, step 2: `identity=oidc` — OpenID Connect with discovery, authorization code with
  PKCE, the ID token verified against the provider's JWKS (RS256/384/512, ES256), groups from a
  configurable claim path with the userinfo fallback. A ready Keycloak realm
  (`hosted/keycloak/`) and `bin/smoke-oidc.sh`, which signs in through a real Keycloak in Docker.

- Hosted mode (W7, first step): `serve --hosted hosted.properties`. Sign-in (the `none`
  provider on loopback; OIDC next), a session cookie with CSRF protection, roles from groups
  (editor, deployer), a workspace per user and branch cloned from the team's repository, commit
  and push as the signed-in person, update from the base branch, the pull-request link, the
  server's environments file, and an audit log. The repository bar on the page; local mode shows
  it too when the tree sits in a git checkout. `bin/smoke-hosted.sh`.

## [0.3.0] - 2026-10-05

### Added

- Connections view: environments (vault URL, bind DN, driver set, tier, trust, SSH) created and
  edited from the page with a connection test; the password and each driver secret the tree's
  drivers need, stored in the macOS Keychain or an owner-only file and never shown again. Reached
  from the Vault view's picker, its empty state, and any connection or credential error.
  `GET /api/credentials`, `/api/credentials/secrets`; `POST /api/credentials/{test,environment,environment/remove,secret}`.
- Secret managers: a password or driver secret as a reference to AWS Secrets Manager, Azure Key
  Vault, Google Cloud Secret Manager, CyberArk CCP, BeyondTrust Password Safe, Bitwarden, Bitwarden
  Secrets Manager, a Terraform output or any command, built from a preset, tested
  (`POST /api/credentials/resolve`) and saved as the core's `…Command=` line; helper scripts
  `bin/secrets/cyberark-ccp.sh` and `bin/secrets/beyondtrust.sh`; a *Check* per configured secret.

## [0.2.0] - 2026-10-05

The first release: local mode complete (W0–W6). 0.1.0 was the unreleased spike.

### Changed

- Built against DirXMLDev 0.8.0: the operation factory is reached through the public
  `Registry.Spec.create`, not reflection.

### Added

- W6 packages view: installed packages per driver and the Library against the catalog
  (upgrade, uninstall, revert customized objects, adopt records, install through the review),
  the catalog's packages, and building a package from the tree into the catalog.
  `GET /api/packages`, `POST /api/packages/build`; `serve --catalog DIR` (or `IDM_CATALOG`),
  supplied to every package operation the page runs.

- W5 provisioning views: a PRD's workflow as a diagram with an activity panel (properties,
  links, data items, insert, rename, remove) and a details tab; a form's fields, JSON and
  bindings; the role and resource catalog. New endpoints `GET /api/prd`, `/api/form`,
  `/api/roles`; every change is one of the core's `flow.*`, `form.*`, `role.*`, `resource.*`
  operations through the review dialog.

- W4 simulator view: the corpus with a verdict per case, one case stage by stage (document
  before and after each policy, trace, queries, commands), trying an input without saving it,
  recording expected output, running with a stage's values and comparing two stages. New
  endpoints under `/api/sim/`; `serve --cases DIR`.

- W3 vault view: compare the tree with an environment's vault, plan and run a deploy, see and
  control the drivers, follow a driver's trace. New endpoints under `/api/vault/`; a write to a
  vault needs the environment's name typed into the page, checked by the server.

- W2 structured policy editor: rules, condition groups, actions, arguments and tokens of a
  DirXML Script policy, driven by a grammar table generated from the DTD
  (`tools/dtd2grammar.py`), sharing one draft with the Source tab and checked live by the
  engine's compiler through the preview endpoint.
- W1 configuration editors: GCVs in scope with per-environment override columns, driver
  settings (shim, parameters, engine control values), the filter, policy-set order with drag,
  link and unlink, the schema map, mapping tables, and the stage-override matrix. Configuration
  files and entitlement definitions are editable as XML.
- `POST /api/batch`: several operations as one transaction. A dry run is run against a
  throwaway copy of the tree and returns each changed file before and after, which the review
  dialog shows; `GET /api/config` and `GET /api/overrides` serve the editors.
- W0 spike. `bin/idmweb serve <tree>`: a loopback server over the DirXMLDev core (session
  token, host and origin checks, tree revision on every write) and a page with the outline,
  the policy-flow fishbone, an artifact view in two modes (structured rules, source), the
  references, the validation report, a generated form for each of the core's operations, and
  live reload when anything changes the tree.
