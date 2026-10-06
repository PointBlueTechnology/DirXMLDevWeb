# Quickstart: one person, one container

Ten minutes from nothing to the web UI, the `idm` CLI and the simulator on your own machine,
all in one container, with your agents able to use it too. No Keycloak, no proxy, no build.

## You need

- Docker (Desktop, or the engine) running.
- **The engine jars** from an Identity Manager engine — `dirxml.jar`, `dirxml_misc.jar`,
  `nxsl.jar`, `xp.jar`, `CommonDriverShim.jar`, `jclient.jar`, `dhutil.jar`, `XDS.jar`,
  `js.jar`, `ldap.jar` — from its `lib/dirxml/classes` (copy the files, not symlinks: `cp -L`).
  They are OpenText's and never part of the image; without them the page runs, but the compile
  check, the simulator and vault access do not.
- Access to the image. Today that is Point Blue's registry,
  `harbor.pointbluetech.com/dirxmldev/dirxml-dev-web`; when the project is public it is
  `ghcr.io/pointbluetechnology/dirxml-dev-web`, no login needed.
- Optionally, a tree: a directory with a `driverset.xml` (from `idm import-live`, `idm import`
  of a Designer export, or a checkout of a repository). Without one the page asks where the tree
  comes from on first run.

## 1. Get the bundle

Every [release](https://github.com/PointBlueTechnology/DirXMLDevWeb/releases) carries
`dirxml-dev-web-single-user-<version>.zip`: `setup.sh`, the compose file, the configuration
template and the reference README. Unzip it anywhere.

```bash
unzip dirxml-dev-web-single-user-0.12.0.zip
```

(From a checkout it is `hosted/docker/single-user/`.)

## 2. Put the engine jars where the container reads them

```bash
mkdir -p ~/idmweb/lib
cp -L /path/to/idm/lib/dirxml/classes/{dirxml,dirxml_misc,nxsl,xp,CommonDriverShim,jclient,dhutil,XDS,js,ldap}.jar ~/idmweb/lib/
```

(`IDM_LIB=/path/to/them` on the next step does the copy for you.)

## 3. One command

With a tree:

```bash
IDMWEB_IMAGE=harbor.pointbluetech.com/dirxmldev/dirxml-dev-web:0.12.0 single-user/setup.sh /path/to/tree
```

Without one:

```bash
IDMWEB_IMAGE=harbor.pointbluetech.com/dirxmldev/dirxml-dev-web:0.12.0 single-user/setup.sh -
```

`setup.sh` pulls the image, makes `~/idmweb` (`IDMWEB_PORT` and a second argument change the
port and the directory), seeds a bare repository with your tree when you gave one, generates
your token and one for agents, writes the configuration and starts the container. It ends with:

```
DirXMLDevWeb is at http://localhost:8080
  sign in with the token in ~/idmweb/idmweb.env   (cat ~/idmweb/idmweb.env)
  ...
```

## 4. Sign in

Open the URL, paste the first token from `~/idmweb/idmweb.env`.

- **With a tree**: open the branch `main`; it is cloned into a workspace of yours and every
  view is live. Edit, review, apply; commit and push from the bar at the top (pushes land in
  `~/idmweb/repo.git`, which you can push on to GitHub later).
- **Without one**: the page asks where the tree comes from — export it from an Identity Vault
  (set up the connection in *Connections* first), import a Designer project (zip or directory)
  or a Designer export, use a repository, or clone a remote. It remembers the answer; more
  trees are added the same way from the project picker.

## 5. The CLI, the simulator, your agents

`~/idmweb/idm` is the `idm` CLI inside the container, in the workspace of the branch you opened
(`IDMWEB_BRANCH`, `IDMWEB_PROJECT` pick another):

```bash
~/idmweb/idm validate tree
```

```bash
~/idmweb/idm simulate tree --cases cases
```

An agent on the same machine (Claude Code, a script, an MCP server) uses the same two doors:
`~/idmweb/idm …` as a shell command, or the API at `http://localhost:8080/api/…` with
`Authorization: Bearer <IDMWEB_AGENT_TOKEN>` (the second line of `idmweb.env`) — every endpoint
the page uses, with the agent's name on each audit line.

## 6. Vaults

*Connections* on the page sets up each environment (URL, bind DN, driver set, tier, trust) with
a connection test, and takes the password and the driver secrets a deploy needs; they are
written to `~/idmweb/config/environments.properties` (owner-only). A credential may be a literal,
a `…Command=` reference to a secret manager ([secret-managers.md](secret-managers.md)) or
`…Env=NAME` with the value in `idmweb.env`. Keychain references do not resolve inside a container.

## Day to day

- Upgrade: set `IDMWEB_IMAGE` to the new version and run `setup.sh` again (the directory, its
  repository, token and configuration are kept).
- Stop: `cd ~/idmweb && docker compose down`. Everything lives in the directory.
- Sharing it with a team later: [hosted-install.md](hosted-install.md) — the same image behind a
  proxy with TLS and your identity provider.

The reference for everything `setup.sh` writes is
[hosted/docker/single-user/README.md](../hosted/docker/single-user/README.md).
