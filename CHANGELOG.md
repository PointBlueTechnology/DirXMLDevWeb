# Changelog

All notable changes to DirXMLDevWeb are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- W0 spike. `bin/idmweb serve <tree>`: a loopback server over the DirXMLDev core (session
  token, host and origin checks, tree revision on every write) and a page with the outline,
  the policy-flow fishbone, an artifact view in two modes (structured rules, source), the
  references, the validation report, a generated form for each of the core's operations, and
  live reload when anything changes the tree.
