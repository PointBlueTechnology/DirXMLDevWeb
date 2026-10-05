# Changelog

All notable changes to DirXMLDevWeb are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
