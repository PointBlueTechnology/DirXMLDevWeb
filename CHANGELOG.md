# Changelog

All notable changes to DirXMLDevWeb are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- W6 packages view: installed packages per driver and the Library against the catalog
  (upgrade, uninstall, revert customized objects, adopt records, install through the review),
  the catalog's packages, and building a package from the tree into the catalog.
  `GET /api/packages`, `POST /api/packages/build`; `serve --catalog DIR` (or `IDM_CATALOG`),
  supplied to every package operation the page runs.

- W5 provisioning views: a PRD's workflow as a diagram with an activity panel (properties,
  links, data items, insert, rename, remove) and a details tab; a form's fields, JSON and
  bindings; the role and resource catalog. New endpoints `GET /api/prd`, `/api/form`,
  `/api/roles`; every change is one of the core's `flow.*`, `form.*`, `role.*`, `resource.*`
  operations through the review dialog.

- W4 simulator view: the corpus with a verdict per case, one case stage by stage (document
  before and after each policy, trace, queries, commands), trying an input without saving it,
  recording expected output, running with a stage's values and comparing two stages. New
  endpoints under `/api/sim/`; `serve --cases DIR`.

- W3 vault view: compare the tree with an environment's vault, plan and run a deploy, see and
  control the drivers, follow a driver's trace. New endpoints under `/api/vault/`; a write to a
  vault needs the environment's name typed into the page, checked by the server.

- W2 structured policy editor: rules, condition groups, actions, arguments and tokens of a
  DirXML Script policy, driven by a grammar table generated from the DTD
  (`tools/dtd2grammar.py`), sharing one draft with the Source tab and checked live by the
  engine's compiler through the preview endpoint.
- W1 configuration editors: GCVs in scope with per-environment override columns, driver
  settings (shim, parameters, engine control values), the filter, policy-set order with drag,
  link and unlink, the schema map, mapping tables, and the stage-override matrix. Configuration
  files and entitlement definitions are editable as XML.
- `POST /api/batch`: several operations as one transaction. A dry run is run against a
  throwaway copy of the tree and returns each changed file before and after, which the review
  dialog shows; `GET /api/config` and `GET /api/overrides` serve the editors.
- W0 spike. `bin/idmweb serve <tree>`: a loopback server over the DirXMLDev core (session
  token, host and origin checks, tree revision on every write) and a page with the outline,
  the policy-flow fishbone, an artifact view in two modes (structured rules, source), the
  references, the validation report, a generated form for each of the core's operations, and
  live reload when anything changes the tree.
