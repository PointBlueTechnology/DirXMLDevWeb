# Upgrading

Every release is an image on GitHub's registry
(`ghcr.io/pointbluetechnology/dirxml-dev-web:<version>`, and `latest`) with its notes on the
[releases page](https://github.com/PointBlueTechnology/DirXMLDevWeb/releases). An upgrade replaces
the image and keeps everything you have: the repository, your workspaces, tokens, configuration,
vault connections and the audit log all live outside it.

## Before you upgrade

1. **Find the version you run.** The page's top bar shows `web … · core …`, and `/api/session`
   reports it.
2. **Read the release notes** of every release since then. A change in default behaviour is
   always the first thing in a release's notes; anything you must do yourself is spelled out
   there.
3. **Back up the folder** (local install) or the data volume and `./config` (team server). An
   upgrade does not touch them, but a backup costs a minute.

Only the latest release gets security fixes ([SECURITY.md](../SECURITY.md)).

**Knowing when there's one.** Since 0.67.0 the server asks GitHub once a day for the latest
release, in the background, and keeps the answer in its data folder. When a newer one is out, the
page's top bar says so ("0.68.0 is available ↗", linking its release notes). **×** hides the note
until the next release. A server that can't reach GitHub simply never shows it. To turn the check
off (an air-gapped server, CI), put `release.check=false` in `hosted.properties`, or set
`IDMWEB_NO_UPDATE_CHECK` in the server's environment.

## The local install (one person, one container)

Run setup again with the new version, then start it. The folder is kept: setup rewrites the
compose file for the new image, and keeps your repository, tokens and configuration.

**macOS, and Windows in PowerShell:**

```bash
docker run --rm --pull always -v "$HOME/idmweb:/idmweb" ghcr.io/pointbluetechnology/dirxml-dev-web:latest setup
```

**Linux:**

```bash
docker run --rm --pull always -u "$(id -u):$(id -g)" -v "$HOME/idmweb:/idmweb" ghcr.io/pointbluetechnology/dirxml-dev-web:latest setup
```

**Then, everywhere:**

```bash
docker compose -f "$HOME/idmweb/compose.yml" up -d
```

`latest` takes the newest release, and `--pull always` makes Docker fetch it. Without that flag,
`docker run` uses whatever `latest` it already holds, which is the release you're on, and nothing
changes. Name a version (`:0.59.0`) to take exactly that one; then no `--pull` is needed. If you
gave `--port`, `--user` or `--podman` the first time, give them again. Your browser session
survives the upgrade, and the page comes back to the branch and view you were on.

Setup also refreshes the agent kit in the folder's `agent/`. If you use an agent, run its setup
again (`/mcp__dirxmldev__setup` in Claude Code) so its skills are the new version's
([agents.md](agents.md)). Agent tokens survive the upgrade.

### Check that it worked

The top bar shows `web … · core …`, and it should name the new release. `setup` also prints the
image it wrote into the folder (`image …:<version>`), and that is the version the container runs:

```bash
docker inspect idmweb --format "{{.Config.Image}}"
```

**Still on the old version?** Usually one of these:
- `setup` ran without `--pull always`, from the `latest` Docker already held. Run it again with the
  flag, or name the version.
- Only `setup` ran. Run `docker compose … up -d` as well: setup writes the compose file, and compose
  replaces the container.
- The folder isn't the one the container uses. Mount the same folder setup used the first time.

### Coming from the zip install (DirXMLDevWeb 0.55.0 and earlier)

Installs made with `setup.sh` from the release zip use the same folder. Stop the old container
first, because the new compose file names the container `idmweb`:

```bash
docker compose -f "$HOME/idmweb/compose.yml" down
```

Then run the two commands above. The old helper `~/idmweb/idm` still works, but
`docker exec idmweb idm …` replaces it, and you can delete it along with `~/idmweb/.engine`.

## The team server

The image is a variable in the server's `.env` (`IDMWEB_IMAGE`). Set it to the new version, pull,
and recreate the container:

```bash
cd /path/to/the/server        # the directory with compose.yml and .env
sed -i 's#^IDMWEB_IMAGE=.*#IDMWEB_IMAGE=ghcr.io/pointbluetechnology/dirxml-dev-web:0.57.0#' .env
docker compose pull idmweb && docker compose up -d idmweb
```

People signed in are asked to sign in again only if the release notes say so. Agent tokens are
kept; people's agents get the new version's skills by running the `setup` prompt again. Check the new
version in `/api/session` or the page's top bar. Keycloak and Caddy are upgraded on their own
schedule; nothing in a DirXMLDevWeb release requires a newer one unless its notes say so.

An image from a registry of your own (a mirror) works the same: push the release's image there and
point `IDMWEB_IMAGE` at it.

## A checkout (the workstation install, developers)

Update both checkouts and rebuild:

```bash
cd ~/IdeaProjects/DirXMLDev && git pull && mvn -q install
cd ~/IdeaProjects/DirXMLDevWeb && git pull && (cd web && npm ci && npm run build) && mvn -q package
```

`bin/idmweb serve <tree>` then runs the new version. `hosted/docker/single-user/setup.sh` rebuilds
the image from the checkouts the same way.

## Rolling back

Run the same steps with the previous version's tag: setup with `:<previous version>` for the
local install, or `IDMWEB_IMAGE=…:<previous version>` for the team server. Your data is untouched,
unless the newer release's notes say it changed a file's format. In that case they also say
whether going back is safe.
