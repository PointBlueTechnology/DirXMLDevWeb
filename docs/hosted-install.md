# Hosted install

One host inside the customer's network, next to the vault. Three containers from
[`hosted/docker/compose.yml`](../hosted/docker/compose.yml): **idmweb** (this server, the page
and the `idm` CLI), **Keycloak** (sign-in; skip it if the customer has an identity provider and
point `oidc.issuer` there), **Caddy** (TLS at the edge, one hostname for both). The image never
carries the NetIQ/OpenText engine jars: the customer mounts them.

For **one person on a workstation** — the web UI, the CLI and the simulator in one local
container, agents included — use [`hosted/docker/single-user/`](../hosted/docker/single-user/README.md)
instead: `setup.sh <tree>` does all of the below for that case. The rest of this page is the
team install.

## 1. Build the image

On a machine with both checkouts built (`mvn -o package` + `npm run build` here,
`mvn -o install` in DirXMLDev):

```bash
hosted/docker/build.sh dirxml-dev-web:0.4.0            # PLATFORM=linux/amd64 for an x86 host from a Mac
docker save dirxml-dev-web:0.4.0 | gzip > dirxml-dev-web-0.4.0.tar.gz
```

Copy the tarball to the host and `docker load < dirxml-dev-web-0.4.0.tar.gz`. (A registry works
too; the image holds nothing proprietary.)

## 2. Lay out the host

```
/srv/idmweb/
  compose.yml  Caddyfile  .env  idmweb.env        # from hosted/docker/, filled in
  config/hosted.properties                        # from hosted/docker/config.example/
  config/environments.properties                  # the vault environments, as the CLI reads them
  config/secrets-<env>.properties                 # driver secrets, or references to a secret manager
  lib/*.jar                                       # the engine jars from the customer's IDM install
  keycloak/realm.json                             # from hosted/keycloak/realm-example.json, adjusted
  catalog/                                        # package catalog (optional)
```

`config/` is owned by uid 1100 (the container's user) and the credential files are `0600`.
`idmweb.env` holds the secrets the configuration references through `*Env` keys: the repository
token, the OIDC client secret, agent tokens. Nothing else holds a value.

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
repository and the data directory. Open `https://<PUBLIC_HOST>/`: Keycloak's sign-in, then the
workbench with "open a branch".

## 5. Agents and the CLI

An agent (CI, an MCP server, a coding agent) does not install anything:

- **API**: `Authorization: Bearer <token>` with a token from `agents=` gives it a session with its
  roles; every endpoint the page uses. Its name is on every audit line.
- **CLI**: `docker exec idmweb idm validate /var/lib/idmweb/workspaces/<user>/<branch>/tree`, or
  any other `idm` command, with the same files and engine jars the server uses. Workspaces are
  under `/var/lib/idmweb/workspaces/<user>/<branch>`.

## 6. The lab (Point Blue)

`https://idmweb.pointbluetech.com:8443` on DockerHost1 (`192.168.103.99`, `~/idmweb/`): Caddy on
8443 with an internal certificate (443 is Harbor's; the name is private), Keycloak under
`/idp` with the example realm, the server on the `edir-test3_default` network so `edir3` is
`ldaps://edir-test3-engine:636`, the engine jars from that container, the repository
`PointBlueTechnology/idm-lab-config` (synthetic tree) through a deploy key. The generated
secrets are in Jerry's Keychain under service `idmweb-lab`. Deployed 2026-10-06.

## 7. Operate

- `docker compose pull && docker compose up -d` (or `docker load` a new tarball) upgrades.
- Workspaces and `audit.log` live in the `idmweb-data` volume; the configuration in `./config`.
- `audit.log` is one JSON line per event; ship it where the customer keeps logs.
- Sessions live in memory: a restart signs everyone out.
- `bin/smoke-container.sh` runs the image end to end on a workstation with Docker.
