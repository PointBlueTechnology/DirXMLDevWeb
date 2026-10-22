# Quickstart: the local install (one person, one container)

Two commands take you from nothing to the web UI, the `idm` CLI and the simulator on your own
machine, all in one container, with your agents able to use it too. There is no Keycloak, no
proxy and no build. This is the **local** install of the [three](../README.md#three-ways-to-run-it):
the same image and server as a team's, configured for one person on localhost. For a team on a
host, see [hosted-install.md](hosted-install.md); to run from a checkout, see
[development.md](development.md).

## You need

**Docker**: Docker Desktop on macOS and Windows, the engine (or Docker Desktop) on Linux. Nothing
else. The commands are the same in a macOS or Linux terminal and in Windows PowerShell. Podman
works too: see [Podman](#podman).

Two things are optional:

- **A tree:** a directory with a `driverset.xml` (from `idm import-live`, `idm import` of a
  Designer export, or a checkout of a repository). Without one, the page asks where the tree comes
  from on first run.
- **The engine jars** from an Identity Manager engine. Only validate's compile check and the
  simulator need them; the page, vault access and the driver operations work without them. Add
  them now or later ([step 4](#4-optional-the-engine-jars)).

The image is public on GitHub's registry, so there is nothing to sign in to:
`ghcr.io/pointbluetechnology/dirxml-dev-web`, one tag per release and `latest`, for amd64 and arm64.

## 1. Set it up

Installing takes two commands. The first runs the image once, as an installer: `setup` writes a
folder, `~/idmweb`, with a compose file in it, `~/idmweb/compose.yml`, then the container exits.
The second command ([step 2](#2-start-it)) starts the server from that compose file. You never
download or write a compose file yourself.

**macOS, and Windows in PowerShell:**

```bash
docker run --rm --pull always -v "$HOME/idmweb:/idmweb" ghcr.io/pointbluetechnology/dirxml-dev-web:latest setup
```

**Linux:** create the folder first and run setup as yourself, so the files are yours:

```bash
mkdir -p ~/idmweb && docker run --rm --pull always -u "$(id -u):$(id -g)" -v "$HOME/idmweb:/idmweb" ghcr.io/pointbluetechnology/dirxml-dev-web:latest setup
```

`setup` runs inside the image and writes one folder, `~/idmweb` (your profile folder's `idmweb`
on Windows). That folder holds everything:

- `compose.yml` and `.env`: the server's container, written from a template inside the image.
  `.env` names the exact release setup came from, so `:latest` today stays that version until you
  upgrade.
- `config/`: the server's configuration.
- `idmweb.env`: your token and one for agents.
- `repo.git`: the repository.
- `data/`: your workspaces.
- `lib/`: for the engine jars.

**With a tree,** mount it and name it, read-only:

```bash
docker run --rm --pull always -v "$HOME/idmweb:/idmweb" -v "/path/to/tree:/tree:ro" ghcr.io/pointbluetechnology/dirxml-dev-web:latest setup --tree /tree --project lab
```

In PowerShell the tree's path is a Windows one: `-v "C:\idm\tree:/tree:ro"`. `setup` seeds a git
repository in the folder with your tree under `tree/` (`--cases DIR`, mounted the same way, adds
simulator cases). `--project` names it on the page.

Other options: `--user NAME` (your name on commits and audit lines; default `me`), `--port N`
(default 8080), `--environments FILE` ([step 6](#6-vaults)). `setup` ends with:

```
DirXMLDevWeb is set up in the folder you mounted at /idmweb (image …:<version>, port 8080).
Start it:
  docker compose -f <that folder>/compose.yml up -d
Then open this link to sign in (it carries your token; keep it to yourself):
  http://localhost:8080/auth/login#signin=…
```

## 2. Start it

Start the server from the compose file setup wrote. It runs as a container named `idmweb` and
restarts with Docker:

```bash
docker compose -f "$HOME/idmweb/compose.yml" up -d
```

## 3. Sign in

Open the link `setup` printed. It signs you in, and the token never leaves your browser: it is in
the part of the URL after `#`, which is not sent to the server, and the page removes it from the
address bar and history. You can also open `http://localhost:8080` and paste the first token from
`idmweb.env` in the folder. `http://127.0.0.1:8080` works as well: the container answers to each
loopback name for its port, and to nothing else.

- **With a tree:** open the branch `main`. It is cloned into a workspace of yours and every view is
  live. Edit, review and apply; commit and push from the bar at the top. Pushes land in the
  folder's `repo.git`, which you can push on to GitHub later.
- **Without one:** the page asks where the tree comes from: export it from an Identity Vault (set
  up the connection in *Connections* first), import a Designer project (zip or directory) or a
  Designer export, use a repository, or clone a remote. It remembers the answer; more trees are
  added the same way from the project picker.

[tutorial.md](tutorial.md) walks through a first session from here: reading a driver set from a
vault, changing a policy, committing and deploying it.

## 4. Optional: the engine jars

Validate's compile check and the simulator run the real Identity Manager engine. Its jars are
OpenText's and never part of the image. Copy them from an engine's `lib/dirxml/classes` (the
files, not symlinks) into the folder's `lib/` with Finder, Explorer or `cp`, then restart:

```bash
docker restart idmweb
```

It needs `dirxml.jar`, `dirxml_misc.jar`, `nxsl.jar`, `xp.jar`, `CommonDriverShim.jar`,
`jclient.jar`, `dhutil.jar`, `XDS.jar` and `js.jar`.

## 5. The CLI, the simulator, your agents

The `idm` CLI runs inside the container, in your workspace of the branch you opened
(`docker exec -e IDMWEB_BRANCH=feature/x idmweb idm …` for another branch, `IDMWEB_PROJECT` for
another project):

```bash
docker exec idmweb idm validate tree
```

```bash
docker exec idmweb idm simulate tree --cases cases
```

The simulator's CLI is `docker exec idmweb sim …` and the Identity Applications helper
`docker exec idmweb apps …`, in the same workspace.

**Agents** (Claude Code, Cursor, a script) get everything a DirXMLDev install gives them
([agents.md](agents.md)):

- **MCP:** the server is an MCP server at `http://localhost:8080/mcp`. Make a token on the page
  (your name at the top right → *agent tokens…*), which shows the command that connects Claude
  Code. The agent acts as you, under your roles.
- **The kit:** `setup` writes this version's rules, skills and docs to `agent/` in the folder: start
  Claude Code there, or copy `agent/.claude/skills` into your own.
- **The CLIs** above, and the API at `http://localhost:8080/api/…` with the same token.

## 6. Vaults

*Connections* on the page sets up each environment with a connection test. The container is a
hosted server for one person, so it keeps an environment in two places in the folder, both
readable by you alone, and never in the tree, the repository or the vault:

- the environment itself (URL, driver set, tier, trust) in `config/environments.properties`, with
  the driver secrets a deploy needs beside it (`config/secrets-<env>.properties`);
- your bind DN and password in your own file, `data/users/<you>/environments.properties`.

The password may be the value itself, `…Env=NAME` with the value in `idmweb.env`, or a `…Command=`
reference to a secret manager whose CLI you have added to the image
([secret-managers.md](secret-managers.md)). Keychain references do not resolve inside a container.
`config/environments.properties` holds no password: the server will not start if it finds one
there.

**Bringing the CLI's environments file along:** mount it and name it, and `setup` splits it. The
environments go to `config/`, each `bindDn`, `trustAll` and password line goes to your own file,
and a relative `<env>.secrets` file comes along:

```bash
docker run --rm --pull always -v "$HOME/idmweb:/idmweb" -v "$HOME/environments.properties:/env/environments.properties:ro" ghcr.io/pointbluetechnology/dirxml-dev-web:latest setup --environments /env/environments.properties
```

Run on an older install whose `config/` file holds passwords, `setup` splits that too and keeps
the original as `environments.properties.before-split`.

`docker exec idmweb idm …` reads the same two files, the environments and your own, so a vault
command there (`docker exec idmweb idm vault.status --env lab`) binds as you do on the page.

## Day to day

- Your session never times out, and a restart (an upgrade, a reboot) brings you back to the branch
  and the view you were on.
- **Upgrade:** run step 1 again with the new version (or `:latest`), then step 2. The folder, with
  its repository, tokens and configuration, is kept. [upgrading.md](upgrading.md) has the details,
  including moving an install made with the old zip, and rolling back.
- **Stop:** `docker compose -f "$HOME/idmweb/compose.yml" down`. Everything lives in the folder:
  back it up, move it or delete it, and that is the whole install.
- **One per machine:** the container is named `idmweb`.
- **Moving to a server for a team:** [hosted-install.md](hosted-install.md) is the same image
  behind a proxy with TLS and your identity provider. Push the folder's `repo.git` to GitHub or
  GitLab and point the server's project at it.

## Podman

Use the same commands with `podman`. Run `setup` with your own uid kept inside the container, and
tell it you use Podman so the compose file does the same for the server (`compose.podman.yml`):

```bash
mkdir -p ~/idmweb && podman run --rm --pull always --userns=keep-id -v "$HOME/idmweb:/idmweb" ghcr.io/pointbluetechnology/dirxml-dev-web:latest setup --podman
```

Then start it with `podman compose -f "$HOME/idmweb/compose.yml" up -d` (or `podman-compose`).
This path has not been tried end to end yet; Docker has, on macOS and Linux.

## From a checkout

Developers working on DirXMLDevWeb itself can still use `hosted/docker/single-user/setup.sh`,
which builds the image from the checkouts. [Its README](../hosted/docker/single-user/README.md)
is the reference for everything it writes.
