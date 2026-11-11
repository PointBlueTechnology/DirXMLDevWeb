# The workstation install: from a checkout, and developing

The third of the [three ways to run it](../README.md#three-ways-to-run-it): the server on your
own machine, on DirXMLDev's class path, in its *local mode* — one tree on disk, no sign-in, no
projects or branches (git is yours to run). It is how the server is developed and the quickest
look at a tree. For one person in a container see [quickstart.md](quickstart.md); for a team,
[hosted-install.md](hosted-install.md).

## Run it

Prerequisites: a [DirXMLDev](https://github.com/PointBlueTechnology/DirXMLDev) checkout beside this
one (`../DirXMLDev`, or set `IDM_HOME`), JDK 21, Maven 3.9, Node 20 or newer, and `curl`. The server
runs on that checkout's own classes, so check out the tag `pom.xml` names there
(`dirxmldev.version`; for example `git checkout v0.69.0`): its default branch can be ahead.

```bash
# once, in the DirXMLDev checkout: its classes
mvn package -DskipTests
```

```bash
# the server and the page; Maven fetches the libraries this pom pins
mvn package
```

```bash
cd web && npm ci && npm run build
```

```bash
# serve a tree (import one with `idm import-live`, `import` or `import-ldif`)
bin/idmweb serve /path/to/tree
```

The libraries this pom pins (dirxml-dev, the simulator, console-auth, the trace parser) are on
Maven Central under `com.pointbluetech`, so Maven fetches them into `~/.m2`. Versions from before
Maven Central are only on GitHub releases: to build an older tag of this repository, run
`bin/install-deps` first, which installs them into `~/.m2` (`--list` shows each pin and whether it
is installed). DirXMLDev carries the same script. The order of the repositories, and building one yourself, is in DirXMLDev's
[docs/install.md §2.0](https://github.com/PointBlueTechnology/DirXMLDev/blob/master/docs/install.md#20-which-repositories-in-which-order).

The launcher puts the simulator, the trace parser and `console-auth` from `~/.m2` on the class path,
with JLDAP for the LDAP classes (DirXMLDev's build puts it in `~/.m2`). Simulator cases are read from `cases/` beside the tree; name
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

A release bumps `pom.xml`, `Serve.VERSION` (a test pins the two together) and the CHANGELOG heading, merges `--no-ff`, tags `vX.Y.Z` and publishes the jar, the page zip and `THIRD-PARTY.md` on GitHub. Before tagging, run `bin/smoke.sh`, `bin/smoke-hosted.sh` and `bin/smoke-container.sh` from `main`. Publishing the release runs `.github/workflows/image.yml`, which builds the image for amd64 and arm64 from the released jars and pushes it to GHCR. The image build also checks out DirXMLSimulator at the release the pom names, for the `sim` CLI and the `dirxml-policy-testing` skill in the agent kit (`hosted/agent-kit`, assembled by `hosted/docker/build.sh`).
