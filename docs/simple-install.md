# Setup in the image: one install for every operating system (design note)

**Status: proposed (2026-10-15). Confirm before building.**

## Why

The local install (one person, one container) is a zip with `setup.sh`, a 190-line shell script.
It needs a POSIX shell, `git`, `openssl` and `sed` on the host, so on Windows it runs only in WSL
or Git Bash, and its helper `~/idmweb/idm` is a shell script too. The image already carries
everything setup needs: a shell, `git`, `python3`, Java, and the server's own code. Setup moves
into the image, so the host needs **Docker and nothing else**. The commands are then the same in
PowerShell, macOS and Linux, and there is no zip.

## The install, after

```bash
docker run --rm -v "$HOME/idmweb:/idmweb" ghcr.io/pointbluetechnology/dirxml-dev-web:latest setup
docker compose -f "$HOME/idmweb/compose.yml" up -d
```

In PowerShell, the same two lines work: `$HOME` is your profile folder, and Docker Desktop
accepts the Windows path in `-v`.

The first command writes `~/idmweb` (the configuration, the tokens, the compose file, and the
repository when you give a tree) and prints the sign-in link. The second starts the server.
Options go after `setup`:

- `--tree /tree`, with the tree mounted read-only: `-v /path/to/tree:/tree:ro`
- `--port 8081`
- `--image <name>` (the compose file's image; default: the image that ran setup)

Then:

- **CLI:** `docker exec idmweb idm validate tree`. The image's own `idm` launcher finds the
  workspace and your credentials file the way the host wrapper does today, so no wrapper script
  is needed on any OS.
- **Engine jars** (optional): copy them into `~/idmweb/lib` (Finder, Explorer or `cp`), then
  `docker restart idmweb`.
- **Upgrade:** run the `setup` line with the new tag, then the `compose up` line. Your folder is
  kept.
- **Stop:** `docker compose -f "$HOME/idmweb/compose.yml" down`.

## How

### `setup` in the image

A new subcommand of the server, `idmweb setup` (Java, in `Serve`), reached through the
entrypoint's `case`. It does what `setup.sh` does today, from inside the container, on `/idmweb`:

1. Writes `compose.yml` from a template in the jar: the image (the one running, unless
   `--image`), the port, `container_name: idmweb`, and the four volumes, relative to the
   compose file. Docker resolves them on the host, so the same file works from any OS.
2. Writes `config/hosted.properties` from the template (token identity, `token.user`,
   `public.url`) unless one exists.
3. Tokens: generates `IDMWEB_TOKEN` and `IDMWEB_AGENT_TOKEN` with `SecureRandom` into
   `idmweb.env` (mode 600) unless they exist.
4. With `--tree`: seeds `repo.git` with the image's `git` (the tree under `tree/`, `cases/`
   beside it, the same `.gitignore`), as today.
5. Environments: the definitions and credentials split that `setup.sh` does with `grep` and
   `sed` moves into Java. That code already parses the same files (`CredentialService`).
6. Prints the sign-in link (`/auth/login#signin=…`, as #123 adds) and the next command.

**File ownership.** Docker Desktop on macOS and Windows maps ownership, so files written in the
container are yours. On Linux, `setup` runs as root in the container only to `chown` what it wrote
to the owner of the mounted `/idmweb`, which it reads with `stat`. `compose.yml` records that
uid:gid as the server's `user:`, as `IDMWEB_UID` does today. Nothing else runs as root.

### The `idm` launcher finds the workspace

`/opt/idmweb/bin/idm` gains what the host wrapper computes today:
- the first project and branch `main` (`IDMWEB_PROJECT` and `IDMWEB_BRANCH` override them);
- the workspace directory under `/var/lib/idmweb/workspaces/…`;
- `IDM_CREDENTIALS` from `token.user`.

It does this only when the current directory is not already a tree, so `docker exec -w …` keeps
working.

### What stays

- `setup.sh` remains for developers working from a checkout. Its local-build path is
  unchanged.
- The team-server install (`hosted-install.md`) is unchanged.
- Podman: the same commands with `podman` (`podman compose`). Rootless Podman keeps your uid, so
  no `chown` is needed.

### Why not one command

`setup` could also start the server if the container mounted the Docker socket, but that hands a
setup step root-equivalent control of the host. Two commands, the second plain `docker compose`,
keep the install inspectable: you can read `compose.yml` before you start it.

## Decisions for you

1. **The zip bundle:** drop it once `setup` ships (recommended; the release notes give the two
   commands), or keep it one more release with a `setup.sh` that just runs them.
2. **`container_name: idmweb`**, one local install per machine, which makes
   `docker exec idmweb …` work (recommended). The alternative is compose's generated name, which
   would need `docker compose -f … exec idmweb …` for the CLI.
3. **Java for `setup`** (recommended: unit-testable, and it reuses `CredentialService` and the
   config writer) rather than porting the shell script into the image.

## Verification

- **Unit tests** for `setup`: a fresh folder, a re-run that keeps tokens and configuration, a tree
  seeded, an environments file split, ownership on Linux.
- **The quickstart run** on macOS, on Linux (a Debian host), and in **Windows PowerShell** with
  Docker Desktop. Each time: setup, compose up, the sign-in link, `docker exec idmweb idm validate
  tree`, adding the jars and restarting, then an upgrade to a newer tag that keeps the folder.
- `bin/smoke-hosted.sh` is unchanged, and a new smoke step runs `setup` into a temporary folder.

## Steps

- **S1** `idmweb setup` (Java), with templates and tests.
- **S2** The `idm` launcher finds the workspace; `container_name`.
- **S3** Docs: the quickstart becomes the two commands, with PowerShell, macOS and Linux side by
  side, and the release notes carry them too.
- **S4** The verification runs above, then a release. The zip goes or stays, as you decide in
  decision 1.
