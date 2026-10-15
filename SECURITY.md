# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue or pull request. Use GitHub's
**[Report a vulnerability](https://github.com/PointBlueTechnology/DirXMLDevWeb/security/advisories/new)**
form (the repository's *Security* tab). The report then stays between you and the maintainers until
a fix is released.

Include, where you can:

- the version (the page's top bar shows it as `web … · core …`, and `/api/session` reports it) and the mode:
  workstation, local container or team server;
- what an attacker needs: network position, a signed-in role (viewer, editor, deployer), an agent
  token, or nothing;
- the steps to reproduce, and what you saw happen.

We acknowledge a report within a few working days. A confirmed problem is fixed in a release, whose
notes say what was fixed, and we credit you there unless you'd rather we didn't.

## Supported versions

Only the latest release gets security fixes. Its notes, and the CHANGELOG, say what each release
fixed.

## What is in scope

The server (`serve` in local and hosted mode), its API and sign-in, the page, the container image
and its launchers, and the install files in `hosted/`. [docs/security.md](docs/security.md) is the
security model: what each mode listens on, how people and agents sign in, which roles may do what,
and how secrets are kept out of trees, logs and responses.

Out of scope here, but welcome at their own repositories: the core
([DirXMLDev](https://github.com/PointBlueTechnology/DirXMLDev)), the simulator, the trace viewer and
directory-console. NetIQ/OpenText Identity Manager itself is the vendor's.
