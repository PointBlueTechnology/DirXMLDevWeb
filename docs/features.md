# What it does

Every view of the page, by area, in every install; the items marked *local and server installs* need the hosted server (sign-in, projects, branches), which the workstation install does not run. The core's operations behind each are the same ones the `idm` CLI and the MCP server run.

- **Projects** (local and server installs): one server holds any number of trees, each a project with its own
  repository (or a checkout used in place); a picker in the repository bar switches, "add a
  project…" takes any of the first-run ways. Workspaces, branches and audit lines are per project.
- **First run** (local and server installs): with no repository configured the page asks where the tree comes
  from — export from an Identity Vault, import a Designer project (zip or directory) or a
  Designer export, use an existing repository (bare, or a checkout in place), use a directory
  of files, or clone a remote — and remembers the answer.
- **New…** beside the Library and every driver in the outline: a policy (linked into a policy
  set at a chosen position — first, last, before or after a policy there — or left unlinked), a
  mapping table, an ECMAScript or GCV resource (linked into the driver's set), an entitlement;
  on the User Application driver also a form, a PRD from a template, a role, a resource and a
  directory-abstraction entity; "New driver" from a base package with its features and their questions answered, a Designer
  export (a driver, or one driver of a driver-set export), a copy, or a shim class. Each
  is the core's `*.add` operation through the review.
- **Driver set**: its DN, the servers it runs on (the primary marked), its drivers, the Library,
  what is linked at the driver-set level, the packages recorded on it, and its GCVs with the
  env-override columns.
- **Schema** (a tab on the driver set, a leaf in the outline): the vault's classes and
  attributes as the tree keeps them (`schema/vault.xml`), a class's attributes on demand, a
  filter by name. *Refresh from vault* reads `cn=schema` of an environment into the tree, only
  when asked; a Designer project's schema comes along on import. New attributes and classes are
  defined here (`schema.add-attribute`, `schema.add-class`, reviewed like every change), marked
  *defined here*, and *Push additions to vault* adds them to an environment — planned first,
  then the environment's name typed; production needs the deployer role. Nothing is removed
  from a vault's schema. The same schema fills the pickers: eDirectory class and attribute
  fields in the filter, the schema map and the entity editor offer its names, attributes
  narrowed to the class.
  *Compare with vault* sets the tree's copy against an environment's live schema (or two
  environments against each other), and a matrix shows every environment of the project against
  the model; nothing written (#77).
- **Events** (a tab on the Vault view, per environment): the Event Logger's store — an object's
  timeline, a subtree, a driver, a policy's logged documents, types, class, a time window, free
  text, a modified attribute; a row with its modify diff, JSON and XML and the other rows of the
  same engine event; the driver or policy named opens in the tree; *Save as case* turns a row
  into a simulator case in `cases/` (planned, shown, then written). Needs `eventsUrl` and the
  reader account in the environments file; `eventsPseudonymise=true` masks people.
- **App schema** (a tab on a driver): what the shim says it can synchronize, read through the
  engine on request (`DriverGetSchema`, the driver stopped) and kept in the tree; the
  application side of the schema map offers its names.
- **Outline** of the driver set: Library, drivers, policies by channel, configuration files,
  entitlements, forms, PRDs.
- **Policy flow**: the fishbone the VS Code extension draws, from the same model. Hover a policy
  for its description; click it to open it. Click a policy set to open it beside the picture:
  reorder its policies (▲ ▼), unlink one, or link an existing policy or resource — one reviewed
  change (`policy.reorder`, `policy.link`, `policy.unlink`).
- **Policy editor in two modes**. *Rules* is a structured editor for a DirXML Script
  policy: rules, condition groups, actions, arguments and tokens, with every element of the
  language available and each node's attributes, order and nesting taken from the grammar.
  *Source* is the XML. Both edit one draft. A pause in editing sends the draft through the
  engine's compiler and the rest of validation, so a mistake is named while it is on screen.
- **Entitlements**: Designer's editor — display name, description, conflict resolution,
  multi-valued, and the values, switchable between none (the requester's), a fixed list of the
  connected system's keys (as an association holds them — GUIDs, ids, names, DNs), and a query
  against the application (class, scope, search classes, attributes read, and how each result
  is shown and granted, with `{attr}`, `{src-dn}` and `{association}` tokens). The XML tab
  remains for anything else.
- **References**: what links to, includes or maps through an artifact.
- **Validation**: the core's whole check suite, including the engine's own compiler — grouped by
  the module each finding occurs in (driver, Library, driver set), filtered by severity, and the
  panel folds to a strip when you want the room.
- **Configuration editors**, per driver and for the driver set:
  - *GCVs* in scope, each from the place the engine would take it, with a column per environment
    for the values that differ per stage, and *Used by*: every policy and configuration document
    (shim parameters, engine controls, filter) that reads the GCV, each a link.
  - *Settings*: shim class and authentication, shim parameters, engine control values.
  - *Filter*: classes and attributes with each channel's setting and the merge authority.
  - *Policy sets*: every set as an ordered list; drag or use the arrows to reorder, link, unlink.
  - *Schema map* and *mapping table* as their own structured tab on the artifact.
  - *Env overrides*: every environment's values in one matrix beside the base.
  - Configuration files and entitlement definitions are also editable as XML.
- **One review for every write.** An editor collects its changes; Review runs them against a
  throwaway copy of the tree and shows each file before and after with the core's verdict;
  Apply writes them as one transaction, or nothing.
- **Operations**: every edit operation the core registers with a form generated from its
  declared arguments, through the same review.
- **Vault**, against any environment the `idm` CLI knows:
  - *Compare*: the tree against the vault, for the driver set or one driver, with the stage's
    overrides applied; each difference opens its detail.
  - *Deploy*: the plan step by step with nothing written, then the deploy itself (snapshot,
    write, restart, verify) once you type the environment's name; the secrets mode (leave alone,
    set the named passwords the vault lacks, re-set every provided secret), *allow missing
    secrets* for a first deploy, and *delete from the vault* for a driver the comparison reports
    as only there (stopped first; the snapshot keeps it).
  - *Snapshots*: every snapshot a deploy or a rollback took, with *Roll back…* — the typed name
    again; the current state is snapshotted first and the result verified.
  - *Jobs*: the engine's jobs (a driver's triggers and health checks, the set's statistics job)
    with their state, started or aborted behind the typed name.
  - *Driver set*: the set as an object — its activation attributes (and whether the engine
    answers ViewActivation), its servers and what the connected server runs, its log level, the
    notification e-mail server (the non-secret settings editable by deployers; the password stays
    with the CLI and the secrets file), users and associations counted (the console's licensing
    figure and each driver's associations by state), work orders.
  - The *Drivers* tab opens with the engine's version, JVM heap and threads, and each driver's
    counters on demand. *manage* on a driver shows `driver.status` (with its recent audit lines),
    sets or resets the trace file, reads the trace file over SSH into the Trace Viewer (when the
    environment names an SSH host), runs a resync (full or since an instant), migrates from the
    application or submits an XDS command (with the simulator canary, and a simulator case's input
    to start from), and lists, sets and removes the driver's named passwords in the vault (values
    write-only). Every write is a deployer's, with the environment's name typed.
  - On the *Drivers* tab, *health* opens a driver's health (the Driver Health job's verdict per
    server, its configuration, whether a health job covers it; *Clear status*), its log level
    (set by level and entry limit, or back on the set's), and its effective rights on an object.
  - *Policies*: the Entitlements Service driver's role-based entitlement policies as the vault
    holds them — priority order, the members the directory computes, what each grants; click a
    policy for its members. They are edited in the tree (`rbe-policies/`) and deployed.
  - *Objects*: one object by DN — its classes, what state it is in on each driver (its
    associations) and its password-sync status; the Identity Console's object inspector.
    *Ask the application* below it sends the same question through a running driver (the engine's
    query verb) and shows the shim's instances.
  - *Drivers*: state, start option (set live: auto, manual, disabled), cache size and trace level
    per driver; *objects* — the driver's associated objects by state with their values, and its
    password-sync settings; start, stop, restart;
    set the trace level; *view* the event cache in pages — pick an event to see its document,
    export it, make a case from it or delete it (deployers; its document is kept first) — export
    the whole cache (the engine's document, or one simulator input), save it as one case, or
    clear it (deployers; the core snapshots it first).
  - *Trace files* (sidebar): recordings of the live trace (*record to a file* on the Trace tab)
    and uploaded trace files, opened in the viewer — parsed once on the server, read in pages
    with the filters applied there — downloaded, removed.
  - *Trace*: the DirXML Trace Viewer in the page (its `dirxml-trace-core` library does the parsing
    and highlighting, so a line reads the same as in the desktop app): the driver set's trace live
    from every server or one, channel/driver/text filters, find, DSTrace colours, compact
    whitespace, timestamp formats, pause, save, copy, a pop-out window, recording to a file; a
    driver's or a policy's name in the trace opens it in the tree; the Drivers tab sets a
    driver's trace level. Before this it was a driver's raw lines with a filter — from any server of the driver set, each of
    which keeps its own (the servers are read from the vault, their addresses from the
    environment's `servers=` mapping or the server object).
- **Provisioning**, for the User Application driver:
  - *PRD*: the workflow drawn as a diagram from the core's flow model. Select an activity to
    change its name, form, addressee and timeout, its links out (add, retype, remove), its data
    items, to insert an activity after it, rename or remove it; the process attributes and the
    forms the PRD binds are on the Details tab. Every change is a `flow.*` operation, reviewed.
  - *Form*: the components as a list (label, required, hidden, order, add, remove through
    `form.field.*`), the document as JSON (saved whole through `form.set-content`), and the
    PRD activities that show it.
  - *Roles and resources*: the catalog, with display names and descriptions editable, add and
    remove, through `role.*` and `resource.*`.
- **Packages**: what each driver and the Library have installed against the catalog, with
  upgrades the catalog offers, customized packaged objects (revert) and missing records
  (adopt); install, upgrade and uninstall through the review; the catalog's packages; *Update
  sites*: browse a package repository (Designer's public sites from the catalog's
  `sites.properties`, or any update-site URL) against the catalog and fetch chosen packages, or
  every newer version of what the tree has installed, so the Installed tab can offer the
  upgrade; a package built from a driver into the catalog.
- **Simulator**: a corpus of cases run through the tree's policies by the engine's own
  classes.
  - *Run all* gives each case its verdict against what it recorded, as `idm simulate` does.
  - A case opens *stage by stage*: the document before and after every policy, as a diff, with
    that policy's trace, queries and commands.
  - Edit the input and *run without saving*; record the output a case should keep producing.
  - Run with a stage's override values, and compare the result with another stage's.
- **Architecture**: the driver set as Designer's Modeler draws it — the Identity Vault with its
  driver set in the centre, one application per driver in two columns with the driver's icon and
  its application type, the driver as a badge on the connector, the drivers that serve the vault
  itself at the foot of each column; hover for facts, click for the flow or the configuration, filter, zoom; *show
  state* colours each driver by its state in the chosen environment; *Download SVG / PNG* for a
  slide or a document (docs/architecture-view.md).
- **Developer**: the whole driver set as one tree, as Designer's outline reads in the Developer
  perspective — each driver's configuration, its Subscriber and Publisher policy sets in engine
  order with the policies in linkage order, schema mapping, resources, entitlements, forms and
  PRDs — with a filter, expand and collapse all, and each node opening its editor.
- **Projects** (hosted, deployers): every project the server holds; *Archive…* writes its
  repository as a git bundle, moves its workspaces and recordings aside under `data.dir/archive/`
  and forgets it, with the bundle to download; *Remove…* only forgets it (docs/hosted-mode.md).
- **Connections** (the driver set is looked up from the vault and chosen from a list): the environments the `idm` CLI reads, set up from the page — vault URL, bind
  DN, driver set, tier, trust, SSH host, prerequisite, event store — with a connection test before saving; on a hosted server the project's *definitions* (deployers) and each person's *own connection* (bind DN, passwords) are two files (docs/multi-user.md); the password
  and each driver secret a deploy needs (shim, Remote Loader, named passwords, read off the
  tree) typed once and kept in the macOS Keychain or an owner-only file, never shown again.
- **Secret managers**: a password or driver secret can be a *reference* instead of a stored
  value — AWS Secrets Manager, Azure Key Vault, Google Cloud Secret Manager, CyberArk CCP,
  BeyondTrust Password Safe, Bitwarden (`bw`, for a workstation) and Bitwarden Secrets Manager
  (`bws`), a Terraform output, or any command. The page builds the command, tests that it yields
  a value, and saves only the command (the core's `…Command=` form); the value is read when
  needed, on the host that runs the server, and never shown. See "Secret managers" below.
- **Navigation**: every view is an address (`#type=…`), so the browser's Back and Forward move
  between views, a reload keeps the place, and a link to a policy, a PRD or a file can be shared.
- **Live follow**: any change to the tree, by anything, reloads the page within a second.
