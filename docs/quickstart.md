# Quickstart: the local install (one person, one container)

Ten minutes from nothing to the web UI, the `idm` CLI and the simulator on your own machine,
all in one container, with your agents able to use it too. No Keycloak, no proxy, no build.
This is the **local** install of the [three](../README.md#three-ways-to-run-it): the same image
and server as a team's, configured for one person on localhost. For a team on a host, see
[hosted-install.md](hosted-install.md); to run from a checkout, [development.md](development.md).

## You need

- **Docker** (Docker Desktop, or the engine) running, or Podman: put `CONTAINER=podman` before
  the command below (rootless works; `podman compose` or `podman-compose`, whichever is installed).
- **macOS or Linux:** nothing else.
- **Windows:** Docker Desktop with its WSL 2 backend, and an Ubuntu (WSL) terminal. Run every
  command below in that terminal, not in PowerShell (see [Windows](#windows)).

That is all. Two things are optional:

- **A tree:** a directory with a `driverset.xml` (from `idm import-live`, `idm import` of a
  Designer export, or a checkout of a repository). Without one, the page asks where the tree comes
  from on first run.
- **The engine jars** from an Identity Manager engine. Only validate's compile check and the
  simulator need them; the page, vault access and the driver operations work without them. Add
  them now or later ([step 4](#4-optional-the-engine-jars)).

The image is public on GitHub's registry, so there is nothing to sign in to:
`ghcr.io/pointbluetechnology/dirxml-dev-web`, one tag per release and `latest`, for amd64 and arm64.

## 1. Get the bundle

Every [release](https://github.com/PointBlueTechnology/DirXMLDevWeb/releases) carries
`dirxml-dev-web-single-user-<version>.zip`: `setup.sh`, the compose file, the configuration
template and the reference README. Unzip it anywhere.

```bash
unzip dirxml-dev-web-single-user-*.zip
```

(From a checkout it is `hosted/docker/single-user/`.)

## 2. One command

```bash
single-user/setup.sh
```

or, with a tree you already have:

```bash
single-user/setup.sh /path/to/tree
```

The bundle runs its own release's image. To follow every release instead, put
`IDMWEB_IMAGE=ghcr.io/pointbluetechnology/dirxml-dev-web:latest` before the command. Running
`setup.sh` again from a newer bundle moves you to that release and keeps your folder.

`setup.sh` pulls the image and makes one folder, `~/idmweb/`, that holds everything (`IDMWEB_PORT`
and a second argument change the port and the folder). With a tree, it seeds a bare git
repository there. It generates your token and one for agents, writes the configuration, starts
the container and ends with:

```
DirXMLDevWeb is at http://localhost:8080
  open this link to sign in (it carries your token; keep it to yourself):
    http://localhost:8080/auth/login#signin=…
  or sign in with the token in ~/idmweb/idmweb.env   (cat ~/idmweb/idmweb.env)
  ...
```

## 3. Sign in

Open the link. It signs you in, and the token never leaves your browser: it is in the part of the
URL after `#`, which is not sent to the server, and the page removes it from the address bar and
history. You can also open `http://localhost:8080` and paste the first token from
`~/idmweb/idmweb.env`. `http://127.0.0.1:8080` works as well: the container answers to each
loopback name for its port, and to nothing else.

- **With a tree:** open the branch `main`; it is cloned into a workspace of yours and every view
  is live. Edit, review and apply; commit and push from the bar at the top (pushes land in
  `~/idmweb/repo.git`, which you can push on to GitHub later).
- **Without one:** the page asks where the tree comes from: export it from an Identity Vault (set
  up the connection in *Connections* first), import a Designer project (zip or directory) or a
  Designer export, use a repository, or clone a remote. It remembers the answer; more trees are
  added the same way from the project picker.

## 4. Optional: the engine jars

Validate's compile check and the simulator run the real Identity Manager engine. Its jars are
OpenText's and never part of the image. Copy them from an engine's `lib/dirxml/classes` (the
files, not symlinks) and run `setup.sh` again; it copies them into `~/idmweb/lib/` and restarts
the container:

```bash
IDM_LIB=/path/to/idm/lib/dirxml/classes single-user/setup.sh
```

It needs `dirxml.jar`, `dirxml_misc.jar`, `nxsl.jar`, `xp.jar`, `CommonDriverShim.jar`,
`jclient.jar`, `dhutil.jar`, `XDS.jar` and `js.jar`.

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

*Connections* on the page sets up each environment with a connection test. The container is a
hosted server for one person, so it keeps an environment in two places, both on your disk and
readable by you alone, and never in the tree, the repository or the vault:

- the environment itself (URL, driver set, tier, trust) in `~/idmweb/config/environments.properties`,
  with the driver secrets a deploy needs beside it (`~/idmweb/config/secrets-<env>.properties`);
- your bind DN and password in your own file, `~/idmweb/data/users/<you>/environments.properties`.

The password may be the value itself, `…Env=NAME` with the value in `idmweb.env`, or a `…Command=`
reference to a secret manager whose CLI you have added to the image
([secret-managers.md](secret-managers.md)). Keychain references do not resolve inside a container.
`config/environments.properties` holds no password: the server will not start if it finds one
there. With `IDM_ENVIRONMENTS` set, `setup.sh` splits your CLI file for you: the environments go to
`config/`, each `bindDn`, `trustAll` and password line to your own file, and a relative
`<env>.secrets` file comes along. Run again on an older install whose `config/` file holds
passwords, it splits that too and keeps the original as `environments.properties.before-split`.

`~/idmweb/idm` reads the same two: the environments, and your own file through `IDM_CREDENTIALS`,
so a vault command there (`~/idmweb/idm vault.status --env lab`) binds as you do on the page. An
`idm` from before 0.51.0 does not: run `setup.sh` again to rewrite it.

## Windows

Run everything in an Ubuntu (WSL) terminal, with Docker Desktop's WSL 2 integration turned on for
that distribution (Docker Desktop → Settings → Resources → WSL integration). `setup.sh` is a shell
script, and `~/idmweb/` is your Linux home's folder: `\\wsl$\Ubuntu\home\<you>\idmweb` in
Explorer. Open the link in your Windows browser as usual; `localhost` reaches the container.

If `unzip` is missing: `sudo apt install unzip`. A native PowerShell setup, with Docker as the only
requirement, is planned.

## Day to day

- Your session never times out, and a restart (an upgrade, a reboot) brings you back to the branch
  and the view you were on.
- Upgrade: unzip the new release's bundle and run its `setup.sh` (`~/idmweb/`, with its repository,
  tokens and configuration, is kept).
- Stop: `cd ~/idmweb && docker compose down`. Everything lives in `~/idmweb/` on your disk:
  back it up, move it, delete it, and that is the whole install.
- Moving to a server for a team: [hosted-install.md](hosted-install.md) — the same image behind a
  proxy with TLS and your identity provider; push `~/idmweb/repo.git` to GitHub or GitLab and
  point the server's project at it.

The reference for everything `setup.sh` writes is
[hosted/docker/single-user/README.md](../hosted/docker/single-user/README.md).
