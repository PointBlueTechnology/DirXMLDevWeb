# DirXMLDevWeb

A browser workbench for NetIQ / OpenText Identity Manager driver sets, over the
[DirXMLDev](https://github.com/PointBlueTechnology/DirXMLDev) core: Designer's job, done on an
IDM-as-code tree in git. It runs as a container on your own machine for one person, on a server
for a team, or from a checkout on a workstation — see [Three ways to run it](#three-ways-to-run-it).

Status: released (see [CHANGELOG.md](CHANGELOG.md)); every phase of
[docs/design.md](docs/design.md) is built — editors, vault, simulator, provisioning, packages,
hosted mode. **New here? [docs/quickstart.md](docs/quickstart.md)** — one container, one command.

## A look

The lab driver set (synthetic data) on the hosted server.

**Adding a project** — the first run, and "add a project…" after it: a tree comes from an
Identity Vault, a Designer project or export, a repository on the host, a directory of files,
or a remote to clone.

![Add a project](docs/screenshots/add-project.png)

**The driver set** — one card per driver, the validation counts in the top bar, the findings
grouped by driver on the right.

![The driver set](docs/screenshots/home-driver-set.png)

**Policy flow** — a driver's fishbone: both channels' policy sets with their policies in order,
the schema mapping and input/output transformations on the spine, the filter and the
driver-level sets below. Hover a policy for its description, click one to open it.

![Policy flow](docs/screenshots/policy-flow.png)

**Reordering a policy set** — click a set in the flow and it opens beside the picture: move
policies up and down, unlink one, link an existing one; the change is reviewed before it is
written.

![A policy set opened from the flow](docs/screenshots/policy-flow-set-panel.png)

**Policy sets** — every set of the driver as an ordered list, on the configuration view.

![Policy sets](docs/screenshots/config-policy-sets.png)

**GCVs** — each global configuration value in the driver's scope, where it is defined, and
every policy that reads it.

![GCVs](docs/screenshots/config-gcvs.png)

**Settings** — shim class and authentication, the shim's parameters, the engine control values.

![Settings](docs/screenshots/config-settings.png)

**Filter** — the classes and attributes the driver synchronises, with each channel's setting
and the merge authority.

![Filter](docs/screenshots/config-filter.png)

**Schema map** — the eDirectory-to-application class and attribute mapping as a table.

![Schema map](docs/screenshots/schema-map.png)

**A provisioning request definition** — the workflow of a User Application PRD drawn from its
process: activities, branches and merges, approval and condition links; select an activity to
change it.

![PRD workflow](docs/screenshots/prd-workflow.png)

## What it is, and is not

It is a third client of the DirXMLDev core, next to the `idm` CLI and the MCP server. The page
calls the same typed operations they call, so anything the core can do, it can do, with the
same validation and the same refusals. It is not a port of Designer and contains no OpenText
code. The tree on disk (in git) is the only state: edit here, with the CLI or with an agent, and
the page follows the files.

## What it does

Everything Designer does for a driver set, as pages over the tree on disk: the outline and the
policy flow; structured editors for policies, filters, schema maps, mapping tables, GCVs,
settings, policy sets and environment overrides; entitlements, PRDs, forms, roles and resources;
compare and deploy against a vault, driver control and live trace; the simulator; packages and
update sites; connections and secret managers; and in hosted mode, projects, branches, commits
and pull requests, sign-in and audit. Every write goes through one review (a dry run on a copy
of the tree, file by file) and is applied as one transaction, or not at all. The whole list,
view by view: [docs/features.md](docs/features.md).

## Three ways to run it

| | **Local** — one person, one container | **Server** — a team | **Workstation** — from a checkout |
|---|---|---|---|
| Where | Docker on your own machine, `http://localhost:8080`; everything it keeps is in one folder on your disk (`~/idmweb/`) | a host behind a proxy with TLS, `https://idm.example.com` | your machine, `bin/idmweb serve <tree>`, loopback only |
| Sign-in | one token (yours) and one for your agents | your identity provider (OpenID Connect: Keycloak, Entra, Okta …), groups → roles | none: the URL carries a one-time token |
| The tree | a git repository in that folder, `~/idmweb/repo.git` (or none yet: the page asks) | the team's repository on GitHub or GitLab; a branch per person as a workspace | one tree on disk, edited in place; git is yours to run |
| Projects, branches, commit & push, audit | yes | yes | no — one tree, no sign-in, no audit |
| Vault credentials | a file on your disk, `~/idmweb/config/environments.properties`, readable by you alone — or a reference to a secret manager; never in the tree, never in eDirectory | files on the server's disk, owner-only — or a secret manager | the `idm` CLI's files and your Keychain |
| Engine jars | `~/idmweb/lib/`, mounted into the container | a folder on the host, mounted into the container | DirXMLDev's `lib/` |
| CLI and simulator | `~/idmweb/idm …` inside the container | `docker exec idmweb idm …` | `bin/idm …` from the checkout |
| Get it | [docs/quickstart.md](docs/quickstart.md) | [docs/hosted-install.md](docs/hosted-install.md), [docs/hosted-mode.md](docs/hosted-mode.md) | [docs/development.md](docs/development.md) |

The first two are the same image and the same hosted server (`serve --hosted`), one configured
for one person on localhost and one for a team; the third is the server in its local mode,
for developing it or for a quick look at a tree. Upgrading an install is pulling the next image.

## Documentation

| | |
|---|---|
| [docs/quickstart.md](docs/quickstart.md) | one person, one container, one command |
| [docs/features.md](docs/features.md) | every view, by area |
| [docs/hosted-install.md](docs/hosted-install.md) | the container for a team: image, host layout, proxy, Keycloak, the lab |
| [docs/hosted-mode.md](docs/hosted-mode.md) | hosted configuration: projects, repositories, identity (`none`, `oidc`), roles, agents |
| [docs/security.md](docs/security.md) | what the server refuses, where credentials live, what never leaves it |
| [docs/secret-managers.md](docs/secret-managers.md) | AWS, Azure, GCP, CyberArk, BeyondTrust, Bitwarden, Terraform: a credential as a command |
| [docs/development.md](docs/development.md) | running from a checkout, layout, tests, releasing |
| [docs/limits.md](docs/limits.md) | what still goes through Operations or the CLI |
| [docs/design.md](docs/design.md) | the assessment and the phases |
| [docs/hosted.md](docs/hosted.md) | the hosted-mode design and its decisions |
| [CHANGELOG.md](CHANGELOG.md) | every release |

## License

[MIT](LICENSE). The image and the jars hold nothing of OpenText's; the engine jars a running
instance needs are yours, mounted from your own Identity Manager.
