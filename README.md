# DirXMLDevWeb

A browser workbench for NetIQ / OpenText Identity Manager driver sets, over the
[DirXMLDev](https://github.com/PointBlueTechnology/DirXMLDev) core. It runs on your workstation:
one command serves a page for one IDM-as-code tree.

Status: **W0 spike** (0.1.0). It proves the architecture and is usable for reading a tree and
for editing through the core's operations. The dedicated editors come in later phases; see
[docs/design.md](docs/design.md).

## What it is, and is not

It is a third client of the DirXMLDev core, next to the `idm` CLI and the MCP server. The page
calls the same typed operations they call, so anything the core can do, it can do, with the
same validation and the same refusals. It is not a port of Designer and contains no OpenText
code. The tree on disk (in git) is the only state: edit here, with the CLI or with an agent, and
the page follows the files.

## What the spike does

- **Outline** of the driver set: Library, drivers, policies by channel, configuration files,
  entitlements, forms, PRDs.
- **Policy flow**: the fishbone the VS Code extension draws, from the same model. Click a policy
  to open it.
- **Artifact view in two modes.** *Rules* is a structured, read-only view of a DirXML Script
  policy (each rule: when, do). *Source* is the XML in an editor. Edit the source, review the
  change as a diff with the core's dry-run verdict, then apply.
- **References**: what links to, includes or maps through an artifact.
- **Validation**: the core's whole check suite, including the engine's own compiler.
- **Operations**: every edit operation the core registers (75 today) with a form generated from
  its declared arguments. Dry run first; Apply is offered only when the dry run passed.
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

## Known limits of the spike

- Editing an artifact is XML-first. The structured rule view is read-only.
- Configuration files, entitlements, forms and PRD parts open read-only; change them through
  Operations.
- No vault features yet: compare, deploy, driver control, trace and the simulator are W3–W4.
- The server reaches one DirXMLDev internal by reflection (an operation's factory). A public
  method is proposed upstream; see `TreeService.factoryOf`.
- Local mode only. The hosted mode is designed (docs/design.md) and not built.
