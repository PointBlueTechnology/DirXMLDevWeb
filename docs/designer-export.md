# Designer export

The *Designer* tab on the driver set takes the open tree back to Designer, the way the `idm` CLI
does it (#66). Every route reads the tree as it is on disk, so its output is the CLI's byte for
byte. A new project mints fresh Designer ids, so two new projects of the same tree differ in
their ids, as two runs of the CLI do.

No vault password is ever written: the vault object is written with
`IdentityVaultSavePassword=false`, and none of the routes takes a password.

The examples use a local install's token (`X-IDMWeb-Token`, from the address the server prints).
A hosted install signs in with a session cookie and a CSRF header instead (docs/hosted-mode.md).

```bash
B=http://127.0.0.1:<port>     # the address the server prints (or give --port)
T=<the token after #token= in that address>
```

## The export XML

`GET /api/export/designer` is `idm export <tree> <out.xml>`. Anyone signed in may download it.

| Query | Required | Accepted values |
|---|---|---|
| `driver` | no | a driver's name in the tree; without it, the whole driver set |

The answer is the XML as an attachment named after the driver set or the driver. An unknown
driver is 404.

```bash
curl -s -H "X-IDMWeb-Token: $T" "$B/api/export/designer" -o driverset.xml
```

## A project as a zip

`POST /api/export/project-zip` is `idm export-project`, with the project going both ways as a
zip. Editors may use it. The parameters are in the query; for an update the body is the
project's zip.

| Query | Required | Accepted values |
|---|---|---|
| `mode` | no | `update` (the default) or `new` |
| `dryRun` | no | `true` (the default) or `false` |
| `name` | for `new` | the new project's name: letters, digits, space, dot, dash, underscore; up to 100 characters. It becomes the folder and `.proj` name |
| `vaultName`, `vaultHost`, `vaultUser`, `server`, `serverContext` | no, `new` only | as `--vault-name`, `--vault-host`, `--vault-user`, `--server`, `--server-context`; refused (400) with `update` |

The update's body is the Designer project zipped: either its folder or its contents (`.project`
at the zip's root or in its one folder). It may be up to 512 MB and unpack to 2 GB.

A dry run, or a refusal, answers with JSON: the CLI's `--json` (`ok`, `refusal`, `createdFiles`,
`changedFiles`, `deletedFiles`, `mintedIds`, `notes`) plus `operation`, `dryRun`, `written` and
`name`. An apply answers with the project as `application/zip`, its folder at the zip's root.

```bash
# preview a new project, then download it
curl -s -H "X-IDMWeb-Token: $T" -X POST "$B/api/export/project-zip?mode=new&name=NewProject&vaultName=LABTREE&dryRun=true"
curl -s -H "X-IDMWeb-Token: $T" -X POST "$B/api/export/project-zip?mode=new&name=NewProject&vaultName=LABTREE&dryRun=false" -o NewProject.zip
```

```bash
# preview an update of an existing project, then download it updated
curl -s -H "X-IDMWeb-Token: $T" -H "Content-Type: application/zip" --data-binary @MyProject.zip -X POST "$B/api/export/project-zip?mode=update&dryRun=true"
curl -s -H "X-IDMWeb-Token: $T" -H "Content-Type: application/zip" --data-binary @MyProject.zip -X POST "$B/api/export/project-zip?mode=update&dryRun=false" -o MyProject-updated.zip
```

## A project in a folder on the host

`POST /api/export/project` is `idm export-project <tree> <path>`. It needs the deployer role,
because it writes on the server's host as the server's own user. In hosted mode the path must lie
under `setup.roots`.

| Field (JSON body) | Required | Accepted values |
|---|---|---|
| `path` | yes | an absolute path on the server's host. For `update`, a Designer project (it has `.project`); for `new`, a folder that does not exist or is empty |
| `mode` | no | `update` (the default) or `new` |
| `dryRun` | no | `true` (the default) or `false` |
| `vaultName`, `vaultHost`, `vaultUser`, `server`, `serverContext` | no, `new` only | as for the zip |

The answer is the same JSON as the zip's dry run, plus `path`.

```bash
curl -s -H "X-IDMWeb-Token: $T" -H "Content-Type: application/json" -X POST "$B/api/export/project" \
  -d '{"mode":"update","path":"/home/me/designer_workspace/MyProject","dryRun":true}'
```

## What the core refuses

The core refuses an update that would remove a driver (a driver is removed from a project in
Designer) and one that adds a driver carrying package metadata (only Designer writes its package
records; deploy the driver and import it from the vault, or write a new project). The refusal is
in `refusal`, and nothing is written.
