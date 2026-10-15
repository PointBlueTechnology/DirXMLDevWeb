# One person, one container (the local install — reference for setup.sh)

**Installing it?** Use the two commands in [docs/quickstart.md](../../../docs/quickstart.md):
`setup` runs inside the image, so the host needs only Docker (macOS, Windows or Linux). This
directory is what that `setup` writes, and `setup.sh` here is the same install **from a
checkout**, for developers working on DirXMLDevWeb (it builds the image from the checkouts).

The web UI, the `idm` CLI and the simulator in one local container, for one person. No Keycloak,
no proxy; the page is on localhost, sign-in is one token, "the team's repository" is a bare git
repository in that folder on your disk (`~/idmweb/repo.git`), and the container runs as you so
every file it writes is yours.

```bash
setup.sh                      # no tree yet: the page asks (default directory ~/idmweb)
setup.sh /path/to/your/tree   # start with a tree you have
```

From a checkout, `setup.sh` builds `dirxml-dev-web:latest` from the checkouts;
`IDMWEB_IMAGE=ghcr.io/pointbluetechnology/dirxml-dev-web:<version>` runs a release instead. `setup.sh` pulls the image when its name has a registry (a bare name is built from the
checkouts, for developers), copies the engine jars from `IDM_LIB` (or DirXMLDev's `lib/` beside a
checkout) when it finds them (optional: only validate's compile check and the simulator need
them; added to a running container, they are read after the restart it does), makes `repo.git`
with your tree under `tree/` (and `cases/` beside your tree, if there is one), or leaves the first
project to the page's first run when you gave none, generates the tokens, writes the
configuration, starts the container and prints:

```
DirXMLDevWeb is at http://localhost:8080
  open this link to sign in (it carries your token; keep it to yourself):
    http://localhost:8080/auth/login#signin=…
  or sign in with the token in ~/idmweb/idmweb.env   (cat ~/idmweb/idmweb.env)
  open a branch (main) on the page; it is cloned under ~/idmweb/data/workspaces/
  the CLI and the simulator in that workspace:  ~/idmweb/idm validate tree    ~/idmweb/idm simulate tree --cases cases
  vault connections: the page's Connections view (your password goes to ~/idmweb/data/users/<you>/)
```

- **Web UI**: open a branch (`main`, or a new one), edit, commit and push; pushes land in
  `~/idmweb/repo.git`, which you can clone, back up, or push on to GitHub later.
- **CLI**: `~/idmweb/idm …` is `idm` inside the container, in the workspace of the first
  project's `main` (`IDMWEB_PROJECT=customer-a IDMWEB_BRANCH=feature/x ~/idmweb/idm …` for
  another), with the same engine jars and tree files the page uses, and your own connections:
  it passes `IDM_CREDENTIALS` (your file under `data/users/`), so `--env` binds as the page does.
  An agent runs the same, or calls the API with an agent token.
- **More trees**: a server holds any number of projects; "add a project…" in the page's project
  picker takes a vault, a Designer project or export, a repository, a directory, or a remote.
- **Simulator**: cases live in the repository's `cases/`; the page's Simulator view and
  `~/idmweb/idm simulate tree --cases cases` run them with the engine.
- **Agents** (Claude Code, a script, an MCP server) on the same machine use the same container:
  `~/idmweb/idm …` as a shell command for the CLI and simulator, or the API at
  `http://localhost:8080/api/…` with `Authorization: Bearer <IDMWEB_AGENT_TOKEN>` (the second
  line of `idmweb.env`); every endpoint the page uses, with the agent's name on each audit line.
- **Engine jars**: `~/idmweb/lib` is a volume mounted read-only at `/opt/idm/lib`; the image
  never contains them. `setup.sh` copies them from `IDM_LIB` or a DirXMLDev checkout beside this
  one; otherwise put the ten jars there yourself (from an engine's `lib/dirxml/classes`, as files,
  not symlinks) and run `setup.sh` again.
- **Vault**: set up environments in the page's Connections view. The environment (URL, driver
  set, tier) goes to `config/environments.properties` and the driver secrets beside it; your bind
  DN and password go to your own file, `data/users/<you>/environments.properties` (`0600`). A
  password may be the value itself, `…Env=NAME` with the value in `idmweb.env`, or a `…Command=`
  reference to a secret manager whose CLI you add to the image. Keychain references do not resolve
  inside the container. `config/environments.properties` must hold no password (the server will
  not start): with `IDM_ENVIRONMENTS` set, `setup.sh` splits your CLI file into the two, and run
  again it splits an older install's `config/` file the same way (keeping the original as
  `environments.properties.before-split`).

**Podman**: `CONTAINER=podman setup.sh …` uses `podman` and `podman compose` (or
`podman-compose`; set `COMPOSE` to choose) and adds `compose.podman.yml` (`userns_mode: keep-id`)
so a rootless container writes files as you. The team layout in `../compose.yml` is plain
compose and runs under `podman compose` as well; Caddy and Keycloak need no changes.

Re-running `setup.sh` on an existing directory keeps the repository, token and configuration
and just restarts the container (a new image is picked up). `docker compose down` stops it;
the folder on your disk (`~/idmweb/` by default) holds everything.

Sharing it with a team later is the full layout in `../compose.yml`: a proxy with TLS,
Keycloak or your identity provider, `identity=oidc`.
