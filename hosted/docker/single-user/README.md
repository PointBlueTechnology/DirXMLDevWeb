# One person, one container

The web UI, the `idm` CLI and the simulator in one local container, for one person, with one
command. No Keycloak, no proxy; the page is on localhost, sign-in is one token, "the team's
repository" is a bare git repository in the directory, and the container runs as you so every
file it writes is yours.

```bash
hosted/docker/single-user/setup.sh /path/to/your/tree          # default directory ~/idmweb
```

It builds the image if there is none (from this checkout and DirXMLDev's beside it, or
`docker load` a release tarball first), copies the engine jars from DirXMLDev's `lib/` (or
`IDM_LIB`), makes `repo.git` with your tree under `tree/` (and `cases/` beside your tree, if
there is one), generates the token, writes the configuration, starts the container and prints:

```
DirXMLDevWeb is at http://localhost:8080
  sign in with the token in ~/idmweb/idmweb.env   (cat ~/idmweb/idmweb.env)
  open a branch (main) on the page; it is cloned under ~/idmweb/data/workspaces/
  the CLI and the simulator in that workspace:  ~/idmweb/idm validate tree    ~/idmweb/idm simulate tree --cases cases
  vault connections: the page's Connections view, or ~/idmweb/config/environments.properties
```

- **Web UI**: open a branch (`main`, or a new one), edit, commit and push; pushes land in
  `~/idmweb/repo.git`, which you can clone, back up, or push on to GitHub later.
- **CLI**: `~/idmweb/idm …` is `idm` inside the container, in the workspace of `main`
  (`IDMWEB_BRANCH=feature/x ~/idmweb/idm …` for another branch), with the same engine jars and
  files the page uses. An agent runs the same, or calls the API with an agent token.
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
- **Vault**: set up environments in the page's Connections view (they are written to
  `config/environments.properties`), or copy yours in. A password may be a literal (the file is
  `0600`), a `…Command=` reference to a secret manager, or `…Env=NAME` with the value in
  `idmweb.env`. Keychain references do not resolve inside the container.

Re-running `setup.sh` on an existing directory keeps the repository, token and configuration
and just restarts the container (a new image is picked up). `docker compose down` stops it;
the directory holds everything.

Sharing it with a team later is the full layout in `../compose.yml`: a proxy with TLS,
Keycloak or your identity provider, `identity=oidc`.
