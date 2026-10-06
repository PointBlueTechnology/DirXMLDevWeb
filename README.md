# DirXMLDevWeb

A browser workbench for NetIQ / OpenText Identity Manager driver sets, over the
[DirXMLDev](https://github.com/PointBlueTechnology/DirXMLDev) core. It runs on your workstation:
one command serves a page for one IDM-as-code tree.

Status: **W1** (unreleased). Reading a tree and editing its configuration are in place; the
structured policy editor, the vault features and the simulator follow. See
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
- **Artifact view in two modes.** *Rules* is a structured, read-only view of a DirXML Script
  policy (each rule: when, do). *Source* is the XML in an editor. Edit the source, review the
  change as a diff with the core's dry-run verdict, then apply.
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
- **Live follow**: any change to the tree, by anything, reloads the page within a second.

## Run it

Prerequisites: a built [DirXMLDev](https://github.com/PointBlueTechnology/DirXMLDev) 0.7.0 or
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

The server prints a URL and opens it. DirXMLDev is found at `IDM_HOME`, else at `../DirXMLDev`.
The server runs on that checkout's own classes, engine jars and simulator, so the page sees
exactly what `bin/idm` sees.

## Security model

- The server binds to loopback only.
- The URL carries a one-time session token in its fragment. The page moves it to session
  storage and sends it as a header; every API request without it is refused.
- Requests naming another host (DNS rebinding) or coming from another origin are refused.
- Files are served only from inside the tree; `.git` and deploy snapshots are not content.
- A write quotes the tree revision it was planned against and is refused if the tree moved.
- No vault credential is read by this spike; it does not talk to a vault yet.

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

## Known limits

- A DirXML Script policy is edited in its source; the structured rule view is read-only (W2).
- Forms and PRD parts open read-only; change them through Operations (W5).
- Stage overrides and whole-document configuration editing need a DirXMLDev with
  `override.set` and `config.set-content` (after 0.7.0); without them those controls are hidden
  or read-only.
- A setting cannot be cleared to empty from the Settings tab; do that in the document's XML.
- No vault features yet: compare, deploy, driver control, trace and the simulator are W3–W4.
- The server reaches one DirXMLDev internal by reflection (an operation's factory). A public
  method is proposed upstream; see `TreeService.factoryOf`.
- Local mode only. The hosted mode is designed (docs/design.md) and not built.
