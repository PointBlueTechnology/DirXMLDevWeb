# DirXMLDevWeb

A browser workbench for NetIQ / OpenText Identity Manager driver sets, over the
[DirXMLDev](https://github.com/PointBlueTechnology/DirXMLDev) core. It runs on your workstation:
one command serves a page for one IDM-as-code tree.

Status: released (see [CHANGELOG.md](CHANGELOG.md)); every phase of
[docs/design.md](docs/design.md) is built — local and hosted mode, editors, vault, simulator,
provisioning, packages.

## A look

The lab driver set (synthetic data) on the hosted server.

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

## Get it

- **One person, one container** — [docs/quickstart.md](docs/quickstart.md): the image from the
  registry, your engine jars, one command; the web UI, the `idm` CLI, the simulator and your
  agents against the same container.
- **A team** — [docs/hosted-install.md](docs/hosted-install.md) (the container behind a proxy
  with Keycloak) and [docs/hosted-mode.md](docs/hosted-mode.md) (configuration, identity, roles).
- **From a checkout** — [docs/development.md](docs/development.md): `bin/idmweb serve <tree>`
  on DirXMLDev's class path, the layout, the tests, releasing.

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
