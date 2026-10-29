# Hosted install

This is the **server** install of the [three](../README.md#three-ways-to-run-it): one host, a
proxy with TLS, your identity provider, the team's repository. For one person on their own
machine, [quickstart.md](quickstart.md) is the local install; [development.md](development.md)
runs the server from a checkout.

One host inside the customer's network, next to the vault. Three containers from
[`hosted/docker/compose.yml`](../hosted/docker/compose.yml): **idmweb** (this server, the page
and the `idm` CLI), **Keycloak** (sign-in; skip it if the customer has an identity provider and
point `oidc.issuer` there), **Caddy** (TLS at the edge, one hostname for both). The image never
carries the NetIQ/OpenText engine jars: the customer mounts them for validate's compile check and
the simulator. Vault access (import, diff, deploy, driver operations) needs none of them: the image
carries open-source JLDAP (DirXMLDev 0.37.0, docs/vendor-free-vault.md there).

For **one person on a workstation** — the web UI, the CLI and the simulator in one local
container, agents included — use the [quickstart](quickstart.md)
instead: two commands, with Docker as the only requirement, do all of the below for that case. The rest of this page is the
team install.

## 1. Build and publish the image

On a machine with both checkouts built (`mvn -o package` + `npm run build` here,
`mvn -o package` in DirXMLDev). `build.sh` copies the jars the two poms name — never the newest
file in `target/` — and refuses to build if an engine or driver jar reached the image context:
the image holds nothing proprietary and must stay that way, so it can live in any registry.

```bash
# publish: both architectures, pushed (needs a buildx builder and a login to the registry)
PUSH=1 ALSO_TAG=latest hosted/docker/build.sh REGISTRY/PROJECT/dirxml-dev-web:<version>

# or a local image for one machine
hosted/docker/build.sh dirxml-dev-web:<version>          # PLATFORM=linux/amd64 for an x86 host from a Mac
docker save dirxml-dev-web:<version> | gzip > dirxml-dev-web-<version>.tar.gz   # then docker load on the host
```

A registry with a self-signed certificate valid longer than 825 days cannot be pushed to from a
Mac (macOS refuses the certificate; the buildx client checks it, not only the builder). Push
from a Linux host that trusts it instead — ship the gathered context and run
`hosted/docker/push-on-host.sh CONTEXT REGISTRY/PROJECT/dirxml-dev-web:<version> latest` there;
it makes a buildx builder that knows the certificate and installs binfmt for arm64 once.

The hosts then run `docker compose pull && docker compose up -d` with `IDMWEB_IMAGE` naming the
registry image.

**GHCR**: every published release also lands on `ghcr.io/pointbluetechnology/dirxml-dev-web:<version>`
(and `latest`, amd64 + arm64) through `.github/workflows/image.yml`, which downloads the jars and
the page from the releases (this repo's, DirXMLDev's, the simulator's), checks out DirXMLDev at
its tag for the helpers and the Terraform module, and runs the same `build.sh` — the engine-jar
check included. Nothing is built from source there, so the image is reproducible from the tags.
The package is public, so `docker compose pull` needs no credentials. To build one by hand:
`gh workflow run image.yml -f version=<version>`.

## 2. Lay out the host

```
/srv/idmweb/
  compose.yml  Caddyfile  .env  idmweb.env        # from hosted/docker/, filled in
  config/hosted.properties                        # from hosted/docker/config.example/
  config/environments.properties                  # the vault environment definitions (URL, driver set, tier): no passwords
  config/secrets-<env>.properties                 # driver secrets, or references to a secret manager
  lib/*.jar                                       # the engine jars from the customer's IDM install
  keycloak/realm.json                             # from hosted/keycloak/realm-example.json, adjusted
  catalog/                                        # package catalog (optional)
```

`config/` is owned by uid 1100 (the container's user) and the credential files are `0600`.
`idmweb.env` holds the secrets the configuration references through `*Env` keys: the repository
token, the OIDC client secret, agent tokens. Under `config/`, only the driver secrets hold values.
Each person's vault password and Git provider token are in their own owner-only file in the data
volume (`users/<subject>/`), and a token typed to clone a project is in `secrets/<project>.repo.token`
there; see §6 for what the volume holds. `environments.properties` must hold no password: the
server will not start with one (docs/multi-user.md).

- `.env`: `PUBLIC_HOST` (the DNS name), `ACME_EMAIL`, the Keycloak admin credentials.
- `hosted.properties`: `public.url=https://<PUBLIC_HOST>`, `bind=0.0.0.0`, the repository
  (`repo.url`, `repo.tokenEnv=IDMWEB_REPO_TOKEN` for an https remote or `repo.sshKey=/etc/idmweb/deploy_key`
  with a `git@github.com:…` remote, `repo.base`, `repo.tree`), `identity=oidc` with
  `oidc.issuer=https://<PUBLIC_HOST>/idp/realms/idm`, the role groups, and the agents.
- Keycloak: the realm's client redirect URI must be `https://<PUBLIC_HOST>/auth/callback`; map
  the customer's directory (LDAP federation) or create users; groups `idm-editors` and
  `idm-deployers` (or whatever `roles.*` name).

Engine jars: copy them out of the customer's engine host or container (`docker cp -L` — some
of them are symlinks there; a 40-byte `jclient.jar` is the link, not the jar). DirXMLDev's
`docs/install.md` lists the ten.

Keycloak's own trust: when Caddy uses `tls internal` or a private CA, give the server the root
with `oidc.caFile=/etc/idmweb/idp-ca.crt` (`docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt`).

## 3. DNS and TLS

`PUBLIC_HOST` must resolve to the host, and ports 80 and 443 must reach it from the internet for
Let's Encrypt. Behind a firewall, give Caddy a certificate instead (`tls /certs/cert.pem
/certs/key.pem` in the site block) or `tls internal` for a lab, and mount the certificate.

## 4. Run

```bash
cd /srv/idmweb && docker compose up -d && docker compose logs -f idmweb
```

The log's first line says the public URL, the identity provider, how many agents, the
repository, the data directory and the heap the server may use (see *Memory* in step 6). Open `https://<PUBLIC_HOST>/`: Keycloak's sign-in, then the
workbench with "open a branch".

## 5. Agents and the CLI

An agent (CI, a coding agent, a script) does not install anything:

- **A person's agent** (Claude Code, Cursor): the person makes a token on the page (*agent
  tokens…*) and connects the agent to `https://<PUBLIC_HOST>/mcp`; the agent acts as that person
  ([agents.md](agents.md)). `agent.tokens=false` turns personal tokens off, `agent.tokens.maxDays`
  (default 365) caps their life. Nothing to set up on the server: `/mcp` and the agent kit are in
  the image.
- **API**: `Authorization: Bearer <token>` with a token from `agents=` gives it a session with its
  roles; every endpoint the page uses. Its name is on every audit line.
- **CLI**: `docker exec idmweb idm validate /var/lib/idmweb/workspaces/<project>/<user>/<branch>/tree`,
  or any other `idm` command, with the same tree files and engine jars the server uses. Workspaces
  are under `/var/lib/idmweb/workspaces/<project>/<user>/<branch>`. `environments.properties`
  holds no passwords; for a vault command (`--env`) name a person's own file, whose connections it
  then uses: `docker exec -e IDM_CREDENTIALS=/var/lib/idmweb/users/<subject>/environments.properties
  idmweb idm vault.status --env stg` (`ls /var/lib/idmweb/users` lists the subjects; that person's
  password goes to the vault). An agent reaches a vault through the API, with its own connection.

## 6. Operate

- Upgrade: set `IDMWEB_IMAGE` in `.env` to the new version, then `docker compose pull idmweb && docker compose up -d idmweb` ([upgrading.md](upgrading.md): before you upgrade, rolling back).
- The `idmweb-data` volume holds the workspaces, `audit.log`, `sessions.json`, each person's
  files (`users/<subject>/`: vault credentials, Git tokens, traces), clone tokens (`secrets/`) and
  archived projects (`archive/`); the configuration is in `./config`. Back up both.
- `audit.log` is one JSON line per event, rotated by size to `audit.log.1` … (`audit.maxBytes`,
  `audit.keep`: [hosted-mode.md](hosted-mode.md#the-audit-log)). Ship the numbered files where the
  customer keeps logs; set `audit.keep=0` if nothing may be deleted.
- Sessions are kept in `<data.dir>/sessions.json` (owner-only): a restart signs nobody out, and
  each person gets their last project and branch back on their next session.
- Memory: the server takes up to three quarters of the container's memory (its first log line
  says `heap up to … MB`).
  - **Cap it on a shared host.** A container without a memory limit sees the whole host, so the
    server may grow to three quarters of the host's memory: 24 GB on a 32 GB host that also runs
    eDirectory or a registry. Give `idmweb` a limit (`mem_limit: 6g` in `compose.yml`), or set
    the heap in `idmweb.env`:

    ```
    IDM_JAVA_OPTS=-Xmx4g
    ```

    then `docker compose up -d`. The first log line should say `heap up to 4096 MB`.
  - **How much:** 4 GB is a reasonable start; raise it if the log shows `OutOfMemoryError`.
- `bin/smoke-container.sh` runs the image end to end on a workstation with Docker.
