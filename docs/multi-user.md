# What's yours and what's shared

On a hosted server (a team server, or the local container), each person has their own copy of
every branch they open, their own vault sign-ins, their own Git provider tokens, agent tokens and
trace files. What describes an environment is the project's, and only the driver secrets are
shared. The workstation install (`serve <tree>`) is one person and uses one environments file,
as the `idm` CLI does.

## Three kinds of thing, three owners

| Kind | Owner | Holds |
|---|---|---|
| **Environment definition** | the project (deployers edit) | name, tier, vault URL, driver-set DN, `requires`, SSH host and user, the event store's URL, table and options. No secrets. |
| **Connection** | the person | per environment: bind DN, where the password comes from, certificate trust, the event store's reader password. Theirs alone: never returned, never copied. |
| **Driver secret** | the environment (deployers edit, deploys read) | shim, Remote Loader and named passwords, each a value or a secret-manager reference. Every deploy to an environment needs the same ones. |

An environment, as one person sees it, is the project's definition plus their own connection for
that name. Without a connection it is listed but marked *set up your connection*, linking to
**Connections**. A person may also define environments of their own (a private lab) in full, in
their own file; nobody else sees those.

This split keeps the vault's own audit honest (each person binds as themselves, so the vault
records who deployed), means the server never holds a shared production password, and stops two
people deploying one tree to different driver sets.

## Where it lives

```
data.dir/
  users/<subject>/                 0700: the person's own, reached only through their session
    environments.properties        their connections by environment name, and environments of their own
    git.properties                 their Git provider tokens by host (pull-requests.md)
    agent-tokens.json              a SHA-256 of each of their agent tokens (agents.md)
    profile.properties             name, email, last seen
    traces/<project>/              their trace recordings and uploads
  workspaces/<project>/<subject>/<branch>/   their copy of each branch they open
  audit.log, sessions.json, projects/, archive/   the server's
environments.file                  the project's definitions (no password keys)
secrets-<env>.properties           beside it: the driver secrets, deployers only
```

`<subject>` is the identity provider's subject (an OIDC `sub`, `token.user` on the local
container, an agent's name). Files are `0600` and directories `0700`. The server runs as one OS
user, so the separation is the server's to enforce: every read and write of a person's directory
goes through their session, and nothing in another person's directory is listed, read or
returned.

**Agents.** An agent named in `agents=` (CI) is a subject too, with its own connections, set
through the same API with its token. A person's own agent token acts as that person, with their
connections ([agents.md](agents.md)).

**The server refuses to start** while `environments.file` holds a password key, and names the keys
to move into people's own files, so a shared password can't stay there unnoticed.

## On the page

- **Connections** lists the project's vaults. Deployers add and edit definitions; each person
  signs in to each vault for themselves (*Sign in*, *Update password*, *Forget*), and sees their
  password's state (rejected, expiring, grace logins left).
- **Every environment picker** (Vault, Schema, App schema, Events, Trace) lists the person's
  environments, with *set up your connection* on the ones they haven't signed in to.
- **Trace files** lists only the person's own recordings.

## The API

| Call | Who | Fields |
|---|---|---|
| `GET /api/vault/environments` | anyone signed in | answers each environment's `tier`, and whether it is `defined` (by the project), `own` (the person's), `connected` |
| `POST /api/credentials/environment` | deployers | **`name`**; the definition's fields (`url`, `driverSet`, `tier`, `requires`, `sshHost`, `sshUser`, `eventsUrl`, …); a password is refused |
| `POST /api/credentials/mine` | anyone signed in | **`name`**; `bindDn`, `password` with `passwordStore` (`file`; or `env:VAR`, `command:…` for deployers), `trustAll`, `eventsPassword` with `eventsPasswordStore`; for an environment of their own, the definition's fields too |
| `POST /api/credentials/mine/remove` | anyone signed in | **`name`** |

Nothing returns a password: reads say what kind of source holds it.

## Traces from before per-person data

Trace recordings made before per-person data (in `data.dir/traces/<project>/`) belong to no one.
The server lists such directories at start-up as a NOTICE, along with workspaces no project
claims, and never removes them. Move a recording under the person who made it, or delete it.
