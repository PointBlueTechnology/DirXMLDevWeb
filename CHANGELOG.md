# Changelog

All notable changes to DirXMLDevWeb are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Trace: jump markers and more highlighting** (DirXMLTraceViewer #2 and #4, through its library 1.6.0).
  *Jump to* under the filters picks a kind of place by the engine's own message (driver start,
  publisher event, subscriber event, subscriber shim, policy set, policy, end transaction, log event,
  pump to eDirectory). ◀ and ▶ (or `[` and `]` in the trace) step to the previous and next one from
  the line last landed on, or from the top of the view, and *most recent* (`Shift-]`) goes to the
  latest. *Time* goes to the first message at or after a time of day, by the messages' own
  timestamps. A jump turns *follow* off and marks the line it lands on; only what is shown is
  searched. Rule names in policy trace and JSON bodies (a REST shim's) are coloured too. Each record
  from the server carries `k` (its marker) and `tm` (its time of day). **Needs dirxml-trace-core 1.6.0.**

## [0.48.0] - 2026-10-14

### Fixed

- **The local container answers at `http://127.0.0.1:8080`** as well as `http://localhost:8080`. A
  hosted server whose `public.url` names a loopback host now accepts each loopback name
  (`localhost`, `127.0.0.1`, `[::1]`) for that port, in `Host` and `Origin`; any other name is still
  refused. A server on a public name is unchanged.
- **`single-user/setup.sh` no longer copies passwords into `config/environments.properties`**, which
  made the server refuse to start. With `IDM_ENVIRONMENTS` set, it splits your CLI file: the
  environments go to `config/`, each `bindDn`, `trustAll` and password line goes to your own
  `data/users/<you>/environments.properties`, and a relative `<env>.secrets` file is copied beside
  the definitions. It names any Keychain reference (it cannot resolve in the container) and any
  `…Env` reference (add the variable to `idmweb.env`). Run again on an older install whose
  `config/` file holds passwords, it splits that file the same way and keeps the original as
  `environments.properties.before-split`.

### Documentation

- **The docs say which install a statement holds for.** docs/security.md opens with a table of the
  workstation install (local mode) against the local container and the team server (hosted mode):
  where it listens, sign-in, the Host and Origin check, roles, where credentials live, the audit
  log. It no longer says the server binds to loopback only.
  - **Container installs.** docs/quickstart.md, the single-user README and README.md now say a
    person's password goes to their own file under `data/users/`, not `config/environments.properties`.
    The CLI inside the container cannot bind to a vault, since it sees no password.
  - **The Keychain and secret managers.** Keychain settings work only on macOS, never in the
    container, and the examples use `…Env`. The image carries none of the secret managers' CLIs.
    docs/secret-managers.md gains a table by install.
  - **Smaller fixes.** "Local install" becomes "workstation" where it meant `serve <tree>`. The trace
    and workspace paths and the environments lookup order are corrected. hosted.md and design.md
    gain a note on what has changed since they were written, and event-logger.md and
    trace-viewer.md are marked as built.

## [0.47.0] - 2026-10-14

### Changed

- **Default behaviour change on a hosted server: environment-variable and Keychain references are a
  deployer's too.** 0.46.0 kept commands to deployers; a variable reference is resolved on the server as
  well, so an editor could name one of the server's own variables and have it sent as a vault password.
  An editor may now keep their own vault password, event-store password or Git provider token only as
  the value in their own (owner-only) file. Saving an `env:` (or Keychain) reference is refused (403); one
  saved before is kept in their file but never read: Connections shows it as *env (deployers only)* and
  the environment as not connected, opening it says why, and a pull request falls back to the project's
  token. **Editors who use `env:` references must re-enter the password or token in their file.** Local
  installs and deployers are unaffected. **Needs DirXMLDev 0.32.0** (`Environments.load(…, false)` leaves
  out every reference form).

## [0.46.0] - 2026-10-14

### Changed

- **Default behaviour change on a hosted server: command references are a deployer's.** A command or
  secret-manager reference runs on the server as the server, so only a deployer may keep their own vault
  password, event-store password or Git provider token that way. An editor's attempt is refused (403),
  and one an editor saved before is kept in their file but never run: Connections shows it as *command
  (deployers only)* and the environment as not connected, opening it says why, and a pull request falls
  back to the project's token. Editors keep theirs in their own file or an environment variable. Local
  installs and deployers are unaffected. **Needs DirXMLDev 0.31.0** (`Environments.load(…, commands)`).

- **The image is public on GHCR**: `ghcr.io/pointbluetechnology/dirxml-dev-web:<version>` and `:latest`
  pull without a login. docs/quickstart.md, the single-user bundle's README and `setup.sh` name it
  (they still pointed at Point Blue's Harbor and at 0.12.0); Harbor stays the lab's (docs/hosted-install.md §6).

## [0.45.0] - 2026-10-14

### Added

- **Pull requests from a local install** (#35, P3 of docs/pull-requests.md): the repository bar's
  *Create pull request…* works on a workstation too, through the provider's CLI (`gh` for GitHub,
  `glab` for GitLab), signed in as you already; nothing is stored. Without the CLI, or not signed in,
  the bar keeps the compare link and says what to run. With this, #35 is complete.

## [0.44.0] - 2026-10-13

### Added

- **Your own Git provider token** (#35, P2 of docs/pull-requests.md): *My Git provider tokens* under
  Connections, one per provider host the server's projects use, kept in your own file (owner-only)
  or read from an environment variable or a secret manager, and never shown again. With one, a pull
  request you create from the bar is yours on GitHub or GitLab; without one, the project's token
  still creates it and the description says you opened it. A token that cannot be read falls back
  to the project's, and the dialog says why. (`GET`/`POST /api/credentials/git`,
  `POST /api/credentials/git/remove`.)

## [0.43.0] - 2026-10-13

### Added

- **Create pull request** from the repository bar (#35, P1 of docs/pull-requests.md), through GitHub's
  or GitLab's API (github.com, GitHub Enterprise, gitlab.com, self-managed GitLab). A short dialog
  takes the title, description and a draft tick, and says whose account creates it. The bar then
  shows the branch's open request (`#12 open ↗`). It is created with the project's repository token,
  and the description says who opened it. A local install, an unknown provider or a project without
  a token keeps the compare-page link. Settings: `repo.provider`, `repo.apiUrl`, `repo.caFile`
  (docs/hosted-mode.md). (`GET`/`POST /api/git/pull-request`.)

### Fixed

- A hosted workspace now tracks its own branch, so a push records `origin/<branch>`: the bar shows
  what is left to push, and the branch has its upstream.

## [0.42.0] - 2026-10-13

### Changed

- **Needs DirXMLDev 0.30.0**: updating a Designer project the core has just written changes nothing
  (the package linkage records are written, and only files whose bytes change are listed), so the
  Designer tab's preview shows only real changes; and a project written from the page now carries the
  tree's jobs, notification templates and entitlement policies.

## [0.41.0] - 2026-10-12

### Added

- **Designer export** (#66), a *Designer* tab on the driver set, with the CLI's output byte for byte:
  - *Download export XML*: the driver set, or one driver, as a Designer export (`idm export`;
    `GET /api/export/designer[?driver=D]`, anyone signed in).
  - A Designer project updated to match the tree or written new (`idm export-project [--new]`),
    previewed file by file first. As a zip, for editors: an existing project uploaded and given
    back updated, or a new one given back (`POST /api/export/project-zip?mode=update|new&dryRun=…`
    with `name`, `vaultName`, `vaultHost`, `vaultUser`, `server`, `serverContext` for a new one;
    the raw zip as the body for an update). To a folder on the server's host, for deployers
    (`POST /api/export/project` with `mode`, `path`, `dryRun` and the same fields; hosted mode
    keeps it under `setup.roots`). No vault password is ever written. The server's package
    catalog fills a new project's own.

## [0.40.0] - 2026-10-12

### Added

- **Take the vault's state into this branch** (#67): on *Compare*, an editor pulls the live vault
  into the workspace's files, for the driver set or the one driver in scope, with the same result
  as `idm import-live --env` (checked byte for byte on edir3): the stage's overrides folded back, a
  secret shim authentication id kept out, files the vault no longer has removed. A dry run shows
  each file before and after; the apply must name the revision the dry run planned against. The
  commit message is suggested in the repository bar. (`POST /api/vault/pull` with `env`, `drivers`,
  `dryRun`, `revision`.)
- **Capture drift first** on deploy (#67): `Deployer.Options.captureDrift`, offered when a deploy is
  refused because the vault changed since the last deploy. The vault's state goes to a local
  `as-found/<stage>/<time>` branch and nothing is deployed; *Merge it into this branch* merges it
  (`POST /api/git/merge-captured`, only an `as-found/` branch; a conflict is listed and the merge
  aborted).

### Changed

- **Needs DirXMLDev 0.28.0**: drift capture clears jobs, entitlement policies and notification
  templates too, and the pull writes the same paths (`AsCodeWriter.MANAGED_PATHS`).
- Drift capture is no longer CLI-only (docs/limits.md).

## [0.39.0] - 2026-10-12

### Added

- **Engine strip** on the Drivers tab (#69): the engine's version, JVM heap and threads, each driver's
  counters (`GET /api/vault/engine`).
- **manage** on each driver (#68, #69): `driver.status` with recent audit lines; the trace file set or
  reset to its previous level and file; the trace file read over SSH with lines, minutes and grep, kept
  as one of your trace files and opened in the Trace Viewer; resync (full or since an instant); migrate
  from the application and submit an XDS command (with the simulator canary, MATCH or MISMATCH, and a
  simulator case's input to start from); the driver's named passwords in the vault listed, set and
  removed, values write-only. (`GET /api/vault/driver-status`, `/trace-show`, `/named-passwords`;
  `POST /api/vault/trace-level` now also takes `file`, `/trace-reset`, `/trace-tail`, `/resync`,
  `/migrate`, `/submit`, `/named-password`; every write a deployer's, with the environment's name typed.)

## [0.38.0] - 2026-10-11

### Changed

- **Needs DirXMLDev 0.26.0**: the core's Designer project readers now read entitlement policies and
  notification templates as real projects hold them, and entitlement refs derived from Designer's display
  documents carry LDAP DNs. Nothing in the web itself changes.

## [0.37.0] - 2026-10-10

### Fixed

- **Architecture view**: every driver card is drawn at the same height again. The cards' class name `app`
  was also the app shell's (`.app { height: 100% }`), and under SVG 2 a CSS height overrides a
  rectangle's own, so each card stretched to the full picture and only the bottom card of each column
  showed it. Every class in the picture now carries an `arch-` prefix, and a test checks that none of
  them collides with the page's stylesheet.

### Changed

- **OIDC sign-in now comes from Directory Console's `console-auth` library** (needs
  `com.pointblue.console:console-auth` 0.1.0, `console.version` in `pom.xml`): discovery,
  authorization code with PKCE, ID-token verification and the groups claim moved there unchanged,
  so DirXMLDevWeb and Directory Console share one implementation. `OidcIdentity` keeps the same
  `oidc.*` settings and behaviour. The launcher, the image and CI put the library's jar on the
  classpath; CI and the image workflow download it from the directory-console release. That
  repository is private, so both need a `DIRECTORY_CONSOLE_TOKEN` secret: a token that can read it.
- The server uses DirXMLDev's `LegacyTls` instead of its own copy (same rule, same
  `idm.tls.legacy` / `IDM_TLS_LEGACY` opt-out).

## [0.36.0] - 2026-10-09

### Added

- **Driver set** tab on the Vault view (needs DirXMLDev 0.25.0): activation, servers, the set's log
  level, the notification e-mail server (non-secret settings editable by deployers), users and
  associations counted, work orders (`GET /api/vault/driverset`, `/email-server`, `/log-level`,
  `/metrics`, `/workorders`; `POST /api/vault/email-server`).
- **health** on each driver of the Drivers tab: the Driver Health job's verdict, the health
  configuration and jobs (*Clear status*), the log level (set, or back on the set's), effective
  rights on an object (`GET /api/vault/health`, `/log-level`, `/rights`; `POST /api/vault/health-clear`,
  `/log-level`; the writes are deployers' with the environment's name typed).

## [0.35.0] - 2026-10-09

### Added

- **Policies** tab on the Vault view (needs DirXMLDev 0.24.0): the Entitlements Service driver's
  role-based entitlement policies as the vault holds them — priority, the members the directory
  computes, the grants; a policy opens its member list (`GET /api/vault/rbe`, `/api/vault/rbe-members`).
- **Ask the application** on the Objects tab: the engine's query verb through a running driver, the
  shim's instances shown (`POST /api/vault/query`; a production environment wants its name typed).

## [0.34.0] - 2026-10-09

### Changed

- **Architecture view**: the drivers that serve the vault itself (User Application, Loopback,
  Role and Resource Service, …) now take the two columns like every other driver, at the foot of
  each column, instead of a row of small cards beneath the vault whose connectors did not meet the
  set cleanly; the usage hint moved out of the picture to a readable line under the canvas, so it
  no longer overran the cards (the state legend stays in the picture for the export).

## [0.33.0] - 2026-10-09

### Added

- **Jobs** (needs DirXMLDev 0.21.0): a **Jobs** tab on the Vault view — every job of the driver
  set with its owner, class, running and configuration state, whether it is scheduled and when it
  next runs, with *Start* and *Abort* behind the typed environment name; the outline and the
  Developer tree list each driver's and the set's jobs; Compare & deploy reports and deploys job
  changes through the core. (`GET /api/vault/jobs`, `POST /api/vault/job` (deployers).)

## [0.32.0] - 2026-10-09

### Added

- **Identity Console gaps in the Vault view** (needs DirXMLDev 0.19.0): on the Drivers tab, each
  driver's **start option** (auto, manual, disabled) set live behind the typed environment
  name, and *objects* — the objects associated with the driver by state (processed, pending,
  manual, disabled, migrate) with their association values, and the driver set's password-sync
  timeout with the driver's password-related settings; an **Objects** tab that inspects one object
  by DN: its classes, its associations across every driver with their state, its password-sync
  status. (`POST /api/vault/start-option` (deployers); `GET /api/vault/associations`,
  `/api/vault/inspect`, `/api/vault/password-sync`.)

## [0.31.0] - 2026-10-09

### Changed

- **Architecture view**: the driver set is drawn as its own panel inside the Identity Vault and
  the connectors run to it — the drivers belong to the set, not to the vault (Jerry). Card text
  is clipped to its card (the second line is the driver's name when the application type names
  it, else the shim), the vault-only cards are wider, and the legend has its own room.

## [0.30.0] - 2026-10-09

### Added

- **Vault: rollback, driver delete and deploy-time secrets from the page** (#34). *Compare &
  deploy* gains the secrets mode (`none` / `missing` / `all`), *allow missing secrets* for a
  first deploy, and a *delete from the vault* tick for each driver the comparison reports as
  only in the vault (the core refuses unless it is stopped; the snapshot captures the subtree).
  A **Snapshots** panel lists the environment's snapshots (when, label, who, objects, drivers,
  server) with *Roll back…* behind the typed environment name — the current state is
  snapshotted first and the result verified; a deploy's result offers *Roll back to it…* too.
  (`GET /api/vault/snapshots?env=`, `POST /api/vault/rollback` (deployers); `plan` and `deploy`
  take `secrets`, `allowMissingSecrets`, `deleteDrivers`.) The interactive step-by-step deploy
  stays with the CLI; the page deploys in parts by scope.

## [0.29.0] - 2026-10-09

### Added

- **Developer view** (#32 A2, docs/architecture-view.md §3): the whole driver set as one tree —
  the set's configuration and library, then each driver's configuration, Subscriber and
  Publisher policy sets in engine order with the policies in linkage order, schema mapping,
  resources, entitlements, forms and PRDs; a filter that keeps matching nodes and their
  ancestors, expand and collapse all, the driver's icon and type on its row, *show state* for the
  chosen environment, every node opening its editor. (`GET /api/developer`.)

## [0.28.0] - 2026-10-09

### Added

- **Architecture view** (#32, docs/architecture-view.md; needs DirXMLDev 0.18.0): the driver set
  as Designer's Modeler draws it — the Identity Vault and its driver set in the centre, one
  application per driver in two columns with the driver's own icon and its Designer application
  type's name, the driver as a badge on the connector, the drivers that serve the vault itself
  (User Application, Loopback, Entitlements Service…) beneath. Hover for the shim and counts,
  click a card for its policy flow or a badge for its configuration, filter, zoom; *show state*
  colours each driver by its state in the chosen environment; *Download SVG* (self-contained:
  tokens and icons embedded) and *Download PNG* (2×). (`GET /api/architecture`,
  `GET /api/driver-icon?driver=`.)

## [0.27.0] - 2026-10-09

### Added

- **Projects view** for deployers on a hosted server (#76): every project with **Archive…** —
  the repository as a git bundle (complete history), the project's workspaces, recordings,
  server-made repository and token moved into `data.dir/archive/<project>-<when>/`, the project
  forgotten; the bundle downloads from the page — and **Remove…**, the plain forget. Past archives
  are listed with what they hold. (`POST /api/setup/archive`, `GET /api/setup/archives`,
  `GET /api/setup/archive/file`; audited as `project.archive`.)

## [0.26.0] - 2026-10-08

### Added

- **Schema compare** (#77; needs DirXMLDev 0.17.0): *Compare with vault* on the Schema tab sets the
  tree's `schema/vault.xml` against the chosen environment's live `cn=schema` — only here, only
  there, or in both with another syntax, OID, flag, superclass or attribute list — with a custom
  definition not yet pushed marked; *against* another environment compares two live schemas;
  *All environments* fills a matrix of every environment of the project against the model.
  Nothing written. (`GET /api/vault/schema-diff?env=E[&other=F]`.)

## [0.25.0] - 2026-10-08

### Changed

- **Definitions in full from the page** (docs/multi-user.md U4): the environment definition form
  takes `requires` and the event store (URL, reader account, table, pseudonymise, tree name); a
  person's connection takes the event store's reader password beside the vault password, from
  a file, a variable, a command or a secret manager. The environment pickers mark an environment
  the project defines but you have not connected to with *set up your connection*, linking to
  Connections (`GET /api/vault/environments` carries `split`, `defined`, `connected`, `own`).

## [0.24.0] - 2026-10-08

### Changed

- **Trace recordings and uploads are the person's** (docs/multi-user.md U3): on a hosted server
  they live under `data.dir/users/<subject>/traces/<project>/`, so one person's recordings are
  never listed for another. Recordings from before stay where they were; at start-up the server
  prints a NOTICE naming every `traces/<x>` and `workspaces/<x>` directory no project claims, and
  never removes one.

## [0.23.0] - 2026-10-08

### Changed

- **Per-person connections on a hosted server** (docs/multi-user.md U2). The environments file
  is now the project's *definitions* — vault URL, driver set, tier, prerequisite, SSH host, event
  store — and holds no password: the server refuses to start while it does, naming the keys. Each
  person's bind DN and password source live in their own `data.dir/users/<subject>/
  environments.properties` (`0600`), written from **Connections → My connections** by any
  signed-in role; the definitions are edited by deployers. A name the project does not define is
  the person's own environment. Driver secrets stay beside the definitions, deployer-only.
  (`POST /api/credentials/mine`, `/api/credentials/mine/remove`; `GET /api/credentials` carries
  `split`, `defined`, `own`, `connected`.)

## [0.22.0] - 2026-10-08

### Changed

- **Environments come from an explicit pair of files** (docs/multi-user.md U1): every service
  that opens an environment takes an `EnvFiles` — one file as the CLI reads it, or the project's
  definitions merged with one person's credentials by the core (DirXMLDev 0.16.0,
  `Environments.load(definitions, credentials)`). Nothing in the server reads the environments
  file by name any more, so `IDM_ENVIRONMENTS` no longer matters to a hosted server and its
  start-up warning is gone. A hosted server still offers everyone the one `environments.file`
  until U2 adds the per-person credentials directory.

## [0.21.0] - 2026-10-08

### Added

- **Trace recordings and files** (docs/trace-viewer.md, T3): *record to a file* on the Trace tab
  writes every record of the live stream, unfiltered, to `<env>/<driver or all>-<time>.trace`
  under the project's data directory (`~/.idm/traces/<tree>` locally); **Trace files** in the
  sidebar lists recordings and uploads, opens one in the viewer (parsed once on the server, read
  in pages with the channel, driver and text filters applied there, so a large file never travels
  whole), downloads it, removes it; *Upload a trace file…* takes a file from a server, up to 1 GB.
  The viewer's pop-out works for a file too (`#type=trace&file=…`).
- **Links into the tree** (T4): in the trace, a driver's name in a header opens the driver, and a
  policy's name — in "Applying policy" lines and anywhere else — opens the policy, dotted-underlined.
- **Compare & deploy**: a change's diff says which side is which — "−" is what the vault holds
  now, "+" is what the tree holds and a deploy writes — with the lines coloured by side.
- **Driver cache, per event**: the cache panel shows the queued events in pages of 200; picking
  one shows its document, exports it, makes a simulator case from it alone, or deletes it — a
  deployer, the environment's name typed, the event's document kept in `deploy-snapshots/` first
  (`DeleteCacheEntries` by position). The whole cache exports as the engine's merged document
  (a recovery copy) or as one simulator input; *Whole cache as a case* and *Clear cache* stay,
  now in an action bar that stays visible above a long list. (`GET /api/vault/cache?from&count`,
  `GET /api/vault/cache-file?kind=cache|input`, `POST /api/vault/cache-event-case`,
  `POST /api/vault/cache-delete`.)

### Changed

- **One environment per tree, chosen once.** The Vault view, the Schema and App schema tabs and
  everything under the Vault view share one remembered choice of environment, and with a single
  environment there is nothing to choose: the name is shown. In hosted mode a project names the
  environments its tree is deployed to with `project.<name>.environments=…` (names from the
  environments file); only those are offered, and a request for another is refused. Jerry: "the
  tree on the left represents a single IDV at a time" — it represents one driver set, deployed to
  its own dev/stage/production environments, and no others.

## [0.20.0] - 2026-10-08

### Added

- **Driver cache** on the Drivers tab: *view* beside the cache size lists the queued events
  (operation, class, object) through the core's `driver.cache view`, with the cache document;
  *Save as case* turns the whole cache into one simulator case (the core's simulator-ready
  input; the files shown first, then written where the simulator lists them); *Clear cache*
  for deployers with the environment's name typed, the count shown, the core's snapshot taken
  first (`GET /api/vault/cache`, `POST /api/vault/cache-case`, `POST /api/vault/cache-clear`).

## [0.19.0] - 2026-10-08

Needs DirXMLDev 0.15.0 and its PostgreSQL JDBC jar (`postgresql-42.7.7.jar`, attached to the core's release; the launchers take it from `~/.m2`, the image carries it).

### Added

- **Events**: a tab on the Vault view reads the environment's Event Logger store (docs/event-logger.md) through the core's event store: filters for an object's timeline, a subtree, a name, a driver, a policy and stage, the driver's own rows or what policies logged, types, class, a time window, free text and a modified attribute; a row opens with its modify diff, JSON, the stored XML and the other rows of the same engine event; the driver and a policy named in a row open in the tree. **Save as case** plans a simulator case from the row (the files shown first), writes it into the tree's `cases/`, and opens the simulator. A store flagged `eventsPseudonymise` is masked before the page sees it. Counts by type, class and driver are over the rows shown.

## [0.18.0] - 2026-10-08

Needs DirXMLDev 0.15.0 (a blank driver's templates).

### Changed

- New driver, "a blank driver with a shim class": the core now writes a starting filter (User and
  Group), shim settings with an example parameter per section, and configuration values, so the
  option says so and the review shows them.

### Added

- Connections: *Look up* beside the driver set field connects with the URL, bind DN and password
  typed (or the saved environment's) and lists the driver sets the account sees
  (`POST /api/credentials/driversets`, one subtree search for `DirXML-DriverSet`); the field
  becomes a select, one found is filled in, *type* goes back to typing a DN.

## [0.17.0] - 2026-10-07

### Fixed

- A connection test or vault bind failing with "simple bind failed" against an eDirectory whose
  LDAPS listener offers only static-RSA suites (`TLS_RSA_*`, e.g. `AES256-GCM-SHA384`): recent JDK
  builds (the image's Temurin 21.0.12, JDK 24+) disable those suites. The server keeps them
  enabled by default, first thing at start-up; opt out with `IDM_TLS_LEGACY=false`
  (`-Didm.tls.legacy=false`). Until an image with this change runs, the same effect comes from a
  `java.security` override file passed with `IDM_JAVA_OPTS=-Djava.security.properties=…`
  (docs/security.md).

## [0.16.0] - 2026-10-07

Needs the DirXML Trace Viewer's library `dirxml-trace-core` 1.5.0 on the class path (the launchers take it from `~/.m2`; CI and the image fetch it from the viewer's release).

### Added

- **Trace viewer**: the Vault view's Trace tab is now the DirXML Trace Viewer on the same parser and highlighting as the desktop app (`dirxml-trace-core`): every driver of the set streamed at once (one event registration per server, or one server chosen), channel, driver and text filters, find with every match marked and Enter/Shift-Enter stepping, the engine's own DSTrace colours, compact whitespace, timestamp formats, pause while the buffer keeps filling, save and copy of what is shown, wrap, font size, buffer sizes. The list is virtualised, so the default fifteen thousand shown records scroll without the DOM holding them all.
- **Pop out**: the trace opens in its own window (`#type=trace&env=…`), the viewer alone, full height; the token travels in the link for the local install.
- **Trace level**: the Drivers tab sets a driver's trace level (0–10) through the core's `driver.trace set`, with the environment's name typed like every vault write (`POST /api/vault/trace-level`, deployers).

### Changed

- Viewing trace is for every signed-in user; driver control and the trace level stay with deployers. The stream sends parsed records (`TraceService.json`) instead of raw lines.

## [0.15.0] - 2026-10-07

Needs DirXMLDev 0.13.0 (the vault schema in the tree, `schema.*`, `vault.schema`, `vault.app-schema`, `vault.deploy-schema`).

### Added

- **Schema**: a Schema tab on the driver set (and a leaf in the outline) shows the vault's classes and attributes as the tree keeps them, with the attributes of a class on demand. *Refresh from vault* reads `cn=schema` of an environment into the tree — only when you ask; nothing reads a vault on its own. A Designer project's schema comes along on import.
- **Define schema and push it**: new attributes and classes are defined on the Schema tab (reviewed like every change), marked *defined here*, and *Push additions to vault* adds them to an environment — planned first, then the environment's name typed to confirm; production needs the deployer role. Nothing is ever removed from a vault's schema.
- **Application schema**: an *App schema* tab on a driver asks the engine for the shim's schema (`DriverGetSchema`; the driver stopped) and keeps the answer in the tree.
- **Pickers from the schema**: eDirectory class and attribute fields in the filter, the schema map and the entity editor offer the tree's schema (attributes narrowed to the class); the application side of the schema map offers the driver's application schema.
- Validation warns about classes and attributes the schema does not know (`schema-unknown-class`, `schema-unknown-attr`, `schema-attr-not-of-class`) once the tree has a schema.

### Changed

- GCVs: each one takes two lines — name, type and the value with the room it needs, then where
  it is defined, what uses it and the environment overrides underneath — instead of every field
  squeezed into one row.
- Filter: each channel mode and merge authority shows as a glyph and a colour on its select
  (⇄ sync green, ⚑ notify blue, ∅ ignore grey, ↺ reset amber; ⬅ vault wins, ➡ app wins, ✕ none)
  with a legend above the classes, so a filter reads at a glance.
- Settings: the engine control values are folded away under their heading (with the count); open
  the section when you need them. × on one is "back to the engine's default" (removed from the
  tree; the engine rewrites its default at the next start) and says so; an engine value cannot be
  cleared to empty.
- A driver's GCV table is grouped by where each value comes from: the driver's own, GCV
  resources the driver links (packages), and the ones inherited from the driver set (its own
  GCVs, and Library resources linked at the set) — with the warning that the inherited ones are
  shared by every driver. The rows carry a `scope` field.

## [0.14.0] - 2026-10-07

Needs DirXMLDev 0.12.0 (`driver.set --clear`, `driver.setting.add/remove`).

### Security (hosted mode)

- `POST /api/credentials/resolve` with a typed `command` needs the deployer role; an editor may
  still resolve a saved credential by key. (#38)
- Path-based setup (`/api/setup/project`, `/existing`, `/directory`) needs the deployer role, and
  the path must lie under `setup.roots` (default: the data directory and `/srv`). (#41)
- A token typed for a clone is written to `<data.dir>/secrets/<project>.repo.token` (owner-only)
  and referenced as `tokenCommand`, never as a literal in `hosted.properties`. (#40)
- A project used in place is one person's working copy: a second principal is refused, and the
  workspace list shows it to its holder only. (#39)

### Added

- Sessions survive a restart (`<data.dir>/sessions.json`, owner-only), a session timeout or a
  restart no longer resets where you were — the last project and branch are reopened on the
  next session, and the page returns to the view it was on after a sign-in. `session.hours=0`
  means never; the one-person install sets it. (#37, #50)
- Outline: a filter box narrows every list to the names holding the text; drivers with nothing
  matching disappear, groups with a match open. (#44)
- Packages: a package jar from your disk is imported into the catalog from the Catalog tab
  (`POST /api/packages/import`). (#36)
- Settings: a value can be cleared to empty (`driver.set --clear`, DirXMLDev 0.12.0; the review
  says "cleared"). (#45)
- CI: `.github/workflows/test.yml` runs the server's tests (DirXMLDev's and the simulator's jars
  from their releases) and the page's tests and build on every pull request and push to main. (#43)
- New driver, the whole of `driver.add`: from a Designer export (a driver export, or a driver-set
  export with the driver picked from the file), from a base package with its features (mandatory
  ones locked, optional ones chosen) and the packages' questions answered in a form, as a copy,
  or blank. The same form answers a package's questions on the Packages view, so an install with
  prompts no longer needs Operations. `GET /api/packages/prompts?packages=…&driver=…` (the
  prompts' definitions, pre-populated by the package's prompt stylesheet); the catalog listing
  carries each package's features, supported shims and whether it asks questions. (#31)
- A loading bar with a spinner under the repository bar while a branch is opened ("Opening X —
  cloning it on the server…"), the tree read and validated; the outline is shown before the
  (slower) validation finishes, so the page is usable sooner.
- MIT license (`LICENSE`, the pom and `package.json`); two screenshots in the README: adding a
  project, a PRD workflow.

### Fixed

- Packages: the banner on a server without a catalog read as an error while installed packages
  were listed; it now says the list comes from the tree and what a catalog would add. (#48)
- Audit log view (hosted mode, deployers): `GET /api/audit?since=&user=&project=&event=&limit=`
  and a filterable table under the advanced buttons — who did what, where, how it went; names
  and flags only. (#42)
- Entities: the Roles view has an Entities tab — each directory-abstraction entity with its
  attributes (key, LDAP/NDS names, type, label, flags) editable in place, attributes added and
  removed (`entity.attr.add` / `set` / `remove`). (#46)
- Settings: shim parameters and engine control values are added (name, display, type, value,
  section) and removed from the tab — what a shim under development needs without editing the
  XML (`driver.setting.add` / `remove`, DirXMLDev 0.12.0).
- Podman: `CONTAINER=podman setup.sh …` for the one-person install (`podman compose` or
  `podman-compose`; `compose.podman.yml` keeps your uid in a rootless container). (#33)

## [0.13.0] - 2026-10-06

### Added

- `docs/quickstart.md`: one person, one container, from the release bundle — no checkout.
  `setup.sh` pulls the image when `IDMWEB_IMAGE` names a registry and starts without a tree
  (`setup.sh -`, the page's first run takes it from there); every release carries
  `dirxml-dev-web-single-user-<version>.zip` (attached by the image workflow).

### Changed

- The README is an overview; its sections moved to `docs/`: features, hosted-mode
  configuration, security model, secret managers, development (run from a checkout, layout,
  tests, releasing), known limits.

### Added

- The image on GHCR: `ghcr.io/pointbluetechnology/dirxml-dev-web:<version>` (+ `latest`, amd64 +
  arm64), built by `.github/workflows/image.yml` when a release is published (or by hand for a
  version). Everything comes from GitHub releases — this repo's jar and page, DirXMLDev's jar and
  tag (helpers, Terraform module), the simulator's jar (now attached to its release) — so the
  image is reproducible from the tags alone and the engine-jar check runs there too.

## [0.12.0] - 2026-10-06

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
