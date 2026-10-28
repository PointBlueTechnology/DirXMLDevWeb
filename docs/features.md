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
- **Conflicts**: an *Update from main* (or a captured state being merged) that conflicts offers
  **Resolve the conflicts…**: per file the incoming version beside the merge, each conflict settled
  with *Keep this branch's*, *Take main's* or *Keep both*, the block arrows, or editing; *Commit
  the merge* redoes the merge on the server and commits exactly that (refused when a side moved or
  the tree wouldn't read). Nothing is left half-merged meanwhile.
- **Merged branches**: **merged branches…** next to *switch* lists the repository's branches whose
  every commit is in the base, with when and by whom each last changed; ticked ones are deleted
  (checked again first; never the open branch), with your own copy unless it holds unpushed work.
  After *Merge into main…*, **Open main and delete <branch>** does it in one go. A repository with
  no GitHub or GitLab in front of it.
- **A newer release**: the top bar says when one is out (the server asks GitHub once a day;
  `release.check=false` turns it off).
- **Changes**: what differs from the last commit, from the base branch, or from what was pushed,
  file by file with both sides. On *since the last commit*, **discard…** puts one file back as the
  last commit has it (a new file is removed), asked once more first; or block by block: the right
  side is the working file, the arrow beside a block puts the last commit's lines back there, the
  right side can be edited, and **Save** writes it (refused, with nothing written, when the tree
  wouldn't read). Both sides stay side by side.
- **Driver set**: its DN, the servers it runs on (the primary marked), its drivers, the Library,
  what is linked at the driver-set level, the packages recorded on it, and its GCVs with the
  env-override columns. On a set with several servers, **Copy server-specific settings from one
  server to another…** gives the target server what the source holds for one driver or every
  driver: GCV values, shim parameters, engine control values, the shim's server and account.
  Each server keeps its own copy of these (#134). The copy is reviewed like any edit, and a deploy
  writes it to that server.
- **Designer** (a tab on the driver set): the round trip back to Designer, as `idm export` and
  `idm export-project` do it, byte for byte. *Download export XML* gives the driver set (or one
  driver) as a Designer export. A Designer project is updated to match the tree, or written new
  with the vault and server details `--new` takes (never a password): uploaded as a zip and
  downloaded back, or, for a deployer, written to a folder on the server's host (hosted: under
  `setup.roots`). Every project write is previewed first, file by file, with the core's notes.
  A driver removed from the tree is removed from a project in Designer, not here. The routes, their
  fields and examples: docs/designer-export.md.
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
  entitlements, forms, PRDs. A Library object that lives in another Library of the vault is
  marked *read-only*. Its page shows the source and where it lives, and offers no edits; links
  to it keep its DN, and compare and deploy leave it alone.
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
    On a driver set served by several servers, each holds its own copy of a driver's GCVs: the
    Value column names the server it shows (*Value on <server> (primary)*), a note above the table
    says which servers follow it, and each of the driver's own GCVs has a field per other server,
    outlined where that server holds a value of its own, *not defined* where its copy lacks the
    GCV. Typing there sets that server's value (`gcv.set --server`); emptying it puts the primary's
    back. A GCV only another server defines is listed too, *not defined on <primary>*. GCVs from a
    resource or the driver set are the same on every server and have no server fields.
  - *Settings*: shim class and authentication, shim parameters, engine control values.
  - *Filter*: classes and attributes with each channel's setting and the merge authority.
  - *Policy sets*: every set as an ordered list; drag or use the arrows to reorder, link, unlink.
  - *Schema map* and *mapping table* as their own structured tab on the artifact. A mapping
    table's grid edits rows and adds columns (text ignoring case, case-sensitive, or numeric, as the
    engine compares them), and *Export CSV* / *Import CSV…* move the whole table
    out and back (a spreadsheet's CSV: header = column names, first column = key). An import
    replaces the table, or with *merge by key* adds and updates rows, and the review shows the
    result before anything is written.
  - *Rename…* and *Delete…* on any artifact (a policy, a mapping table, a resource): a rename rewrites
    every reference (policy-set links, includes, Map tokens); a delete removes its policy-set links
    and is refused, naming them, while anything else refers to it. Both are reviewed first.
  - *References* on any artifact: what refers to it. For a mapping table that is the policies that
    read it and the drivers that run them, since a table is not linked into a driver the way an
    ECMAScript resource is.
  - *Env overrides*: every environment's values in one matrix beside the base.
  - Configuration files and entitlement definitions are also editable as XML.
- **One review for every write.** An editor collects its changes; Review runs them against a
  throwaway copy of the tree and shows each file before and after with the core's verdict;
  Apply writes them as one transaction, or nothing.
- **Operations**: every edit operation the core registers with a form generated from its
  declared arguments, through the same review.
- **Vault**, against any environment the `idm` CLI knows:
  - *Environments* (the setup of an environment against the tree; docs/environment-practices.md):
    two environments' vaults side by side, nothing written to either, as five steps with what each
    still asks: likely renames (*Same driver* records the other environment's name; feeds between
    environments flagged, never matched on their own), the environment's servers mapped onto the
    tree's (several onto one), what only one holds (drivers one by one with *Not yet in* / *Never in*,
    policies, templates and jobs by kind with *… own* / *Planned for*), values that differ (each
    recordable as either environment's override, or all at once for the environment that differs from
    the tree; job schedules and trace included), and the rest grouped by driver with a likely cause
    and a suggestion per change, each acceptable as known (*on purpose* / *later*), which keeps it out
    until it changes. DN differences of letter case alone are set aside. Everything is recorded as
    reviewed changes to the tree.
  - A driver's settings have an *Environments* section: which environments get it, which it is
    planned for, and its name in each.
  - The plan step asks which server runs each new driver when the environment has several.
  - *Compare*: the tree against the vault, for the driver set or one driver, with the stage's
    overrides applied; each difference opens its detail.
  - The tab is three numbered steps, *Compare*, *Plan* and *Deploy*, each with its state (not
    yet, a difference count, ready, blocked, options changed, deployed) and its result beside it;
    each names its scope (one driver, or the whole driver set and its own objects).
  - Under Compare's differences, the two ways to bring them together: *Deploy this branch to
    <environment>* (the Plan step) and *Update this branch from <environment>…*.
  - *Update this branch from <environment>…* (editors): what `idm import-live` writes, for the
    driver set or the one driver in scope. It uses the vault state Compare just read (kept for ten
    minutes, and dropped by a deploy, rollback or capture); the dialog says when that read was made,
    and *Read again* reads the vault anew. A spinner and the time so far show while it reads and
    compares. It is reviewed file by file before and after with nothing
    written, then applied into the workspace's files. The stage's overrides are folded back (a
    value the vault holds for that stage stays in `overrides/<stage>.properties`, not in the base
    tree) and a secret shim authentication id stays out. Files the vault no longer has are
    removed. Each file has a tick: untick one to leave it as the branch has it (a granular update),
    and Apply says how many of them it takes. Within a file the merge is line by line: the left side
    is the branch, the right side what Apply writes (the vault's version to begin with), the arrow
    beside a block keeps the branch's lines there, and the right side can be edited; a merged file
    is marked, and *take all of <env>'s* / *keep all of this branch* start it over. A manifest (`driverset.xml`, a driver's `driver.xml`)
    taken apart from the files it lists is warned about, and a choice that would leave the tree
    unreadable is refused. The commit message is suggested; committing stays yours.
  - *Deploy*: the plan step by step with nothing written, then the deploy itself (snapshot,
    write, restart, verify) once you type the environment's name; the secrets mode (leave alone,
    set the named passwords the vault lacks, re-set every provided secret), *allow missing
    secrets* for a first deploy, and *delete from the vault* for a driver the comparison reports
    as only there (stopped first; the snapshot keeps it). Against production the plan runs the
    production checks too, before anything is typed, and says what stands in the way in plain
    words with a button for the way on: *Push*, *Get latest main*, or *Capture <environment>'s
    current state* when its state isn't on record or has changed outside the tree. A capture reads
    the vault, records its state on a local `as-found/<stage>/<time>` branch (or, when the vault
    matches a commit, records that commit) and writes nothing to the vault; it is followed by
    *Merge it into this branch* (a conflict is listed and the merge undone), *Commit and push the
    record* and *Compare again*.
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
    from every server or one, channel/driver/text filters, find, DSTrace colours (rule names and
    JSON bodies too), *Jump to* a kind of place — driver start, publisher or subscriber event,
    subscriber shim, policy set, policy, end of transaction, log event, pump to eDirectory — with
    ◀ / ▶ (`[` / `]`) and *most recent* (`Shift-]`), or to a time of day; *Fold* a policy set, a
    policy or an XML document to its first line (a toggle beside it, or every one of a kind at
    once), each driver's and channel's own lines only, with find and the jumps opening what they
    land in; compact
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
    remove, through `role.*` and `resource.*`. A role's or resource's container and its
    category are separate: the category is a picker over the Directory Abstraction Layer's list
    (`roles-category` / `resources-category`), the container its own field. *Categories* lists
    both lists' keys with their labels and use, edits the English label, and adds or removes a
    key (`category.*`; a key still in use cannot be removed).
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
  slide or a document.
- **Developer**: the whole driver set as one tree, as Designer's outline reads in the Developer
  perspective — each driver's configuration, its Subscriber and Publisher policy sets in engine
  order with the policies in linkage order, schema mapping, resources, entitlements, forms and
  PRDs — with a filter, expand and collapse all, and each node opening its editor.
- **Compare projects** (hosted, more than one project): for a project per environment. This
  project and another, both from their base branch, each difference by driver and by what the
  pair's promotion record says changed it (pending, both changed, this project's own, known);
  files side by side, merged line by line; the chosen files and values promoted into a new branch,
  validated, committed with the record and pushed for review. *Pair with…* proposes the map of
  driver names and servers and takes the first record; known differences are accepted from the
  list; cases move with their driver. MCP `compare_projects` and `promote_changes`
  (docs/compare-projects.md).
- **Projects** (hosted, deployers): every project the server holds; *Archive…* writes its
  repository as a git bundle, moves its workspaces and recordings aside under `data.dir/archive/`
  and forgets it, with the bundle to download; *Remove…* only forgets it (docs/hosted-mode.md).
- **Connections** (the driver set is looked up from the vault and chosen from a list): the environments the `idm` CLI reads, set up from the page — vault URL, bind
  DN, driver set, tier, trust, SSH host, prerequisite, event store — with a connection test before saving; on a hosted server the project's *definitions* (deployers) and each person's *own connection* (bind DN, passwords) are two files (docs/multi-user.md); the password
  and each driver secret a deploy needs (shim, Remote Loader, named passwords, read off the
  tree) typed once and kept in an owner-only file (or, on a macOS workstation, the Keychain),
  never shown again. On a hosted server an editor keeps only the value itself in their own file;
  references below are a deployer's (docs/security.md).
- **Secret managers**: a password or driver secret can be a *reference* instead of a stored
  value — AWS Secrets Manager, Azure Key Vault, Google Cloud Secret Manager, CyberArk CCP,
  BeyondTrust Password Safe, Bitwarden (`bw`, for a workstation) and Bitwarden Secrets Manager
  (`bws`), a Terraform output, or any command. The page builds the command, tests that it yields
  a value, and saves only the command (the core's `…Command=` form); the value is read when
  needed, on the host that runs the server, and never shown. On a hosted server this is a
  deployer's, and the container image carries none of these CLIs (docs/secret-managers.md). See
  "Secret managers" below.
- **Repository bar**: the branch, what changed since the last commit, commit and push, update from
  the base branch, and on a hosted server *Create pull request…* through GitHub's or GitLab's API,
  then the branch's open request as a link (docs/pull-requests.md). With your own provider token
  (Connections, *My Git provider tokens*) the request is yours on the provider. A workstation
  install (`serve <tree>`) creates it through `gh` or `glab`, signed in as you already; the local
  container is a hosted server and uses the API.
- **Agent tokens** (local and server installs): your name at the top right → *agent tokens…*.
  Make a token for an agent (a label, 7 to 365 days), shown once with the command that connects
  Claude Code; your tokens with when each was made, expires and was last used, and *revoke*.
  *Set up your agent* names the MCP `setup` prompt and gives its text to paste into other agents;
  *Download the agent kit* gives this version's rules, skills and docs. An agent with your token
  acts as you through the MCP server at `/mcp` (docs/agents.md), marked `via` the token in the
  audit log.
- **Navigation**: every view is an address (`#type=…`), so the browser's Back and Forward move
  between views, a reload keeps the place, and a link to a policy, a PRD or a file can be shared.
- **Live follow**: any change to the tree, by anything, reloads the page within a second.
