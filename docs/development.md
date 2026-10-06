# The workstation install: from a checkout, and developing

The third of the [three ways to run it](../README.md#three-ways-to-run-it): the server on your
own machine, on DirXMLDev's class path, in its *local mode* — one tree on disk, no sign-in, no
projects or branches (git is yours to run). It is how the server is developed and the quickest
look at a tree. For one person in a container see [quickstart.md](quickstart.md); for a team,
[hosted-install.md](hosted-install.md).

## Run it

Prerequisites: a built [DirXMLDev](https://github.com/PointBlueTechnology/DirXMLDev) at the
version `pom.xml` names (`dirxmldev.version`, 0.11.0 now; its `bin/idm doctor` is green), JDK 21,
Maven 3.9, Node 20 or newer.

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

## Releasing

A release bumps `pom.xml`, `Serve.VERSION` (a test pins the two together) and the CHANGELOG heading, merges `--no-ff`, tags `vX.Y.Z` and publishes the jar and the page zip on GitHub. Publishing the release runs `.github/workflows/image.yml`, which builds the image for amd64 and arm64 from the released jars, pushes it to GHCR and attaches the single-user bundle to the release. The lab pulls its image from Harbor (see hosted-install.md).
