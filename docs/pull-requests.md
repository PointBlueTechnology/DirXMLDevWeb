# Pull requests

On a branch that differs from the base, the repository bar offers **Create pull request…** (a merge
request on GitLab). The request is made through the provider's API, without leaving the page.
Once it exists, the bar shows it as a link with its number and state (`#12 open ↗`, `!12` on
GitLab), and no second one is offered.

## Creating one

1. **Push the branch.** The button stays disabled until the branch is pushed.
2. **Create pull request…** opens a dialog:
   - **Title**, required. It starts as the branch's last commit subject.
   - **Description.** It starts as the list of the branch's commit subjects.
   - **Draft**, unticked by default.

   The dialog says which account will be the author before you choose **Create**.
3. **Later pushes** update the request, since the provider follows the branch.

Reviewers, labels, assignees and merging stay on the provider. A repository with no GitHub or
GitLab in front of it is merged on the page instead ([git-workflow.md](git-workflow.md)).

## Providers

GitHub (github.com and Enterprise) and GitLab (gitlab.com and self-managed). The provider and its
API are worked out from the remote: `github.com`, or a host whose name contains `gitlab`. A project
on another host name says so in `hosted.properties`:

```properties
project.<name>.repo.provider=github                    # github | gitlab
project.<name>.repo.apiUrl=https://git.example.com/api/v3
project.<name>.repo.caFile=/etc/idmweb/git-ca.crt      # a self-hosted provider's private CA (else oidc.caFile)
```

Any other provider (Azure DevOps, Bitbucket), a project without a token, or a provider the server
can't reach gets a link to the provider's compare page instead.

## Whose account

A request is created as someone: the provider names that account as its author and sends its
notifications.

- **Your own provider token, when you have one.** *Connections → My Git provider tokens* holds one
  per provider host: **Add**, **Replace**, **Forget**. The request is then yours on the provider.
  - **Where it's kept:** the token stays in your own owner-only file
    (`data.dir/users/<you>/git.properties`). Nothing gives its value back.
  - **References:** a deployer may keep it as a reference instead (an environment variable, a
    command or a secret manager). An editor's reference is refused when saved, and one saved
    earlier is not used ([security.md](security.md)).
- **Otherwise, the project's repository token**, the one the server pushes with. The request is
  the token's account's (a bot or service user), and its description ends with "Opened by
  <your name> from DirXMLDevWeb".
- **A token that can't be read** (an unset variable, a failing command): the project's is used
  and the dialog says why.

The token needs to be allowed to create requests: on GitHub *Pull requests: read and write* (with
*Contents* for pushing), on GitLab the *api* scope. Otherwise the provider's answer is shown as it
is, with the compare link.

## The workstation install

A workstation install (`serve <tree>`) has no repository token. It uses the provider's own CLI,
`gh` for GitHub or `glab` for GitLab, when it is installed and signed in (`gh auth status`). The
request is then yours, through your existing sign-in, and nothing new is stored. When the CLI is
missing or signed out, the dialog says what to run (`gh auth login --hostname <host>`) and offers
the compare link. The local container is a hosted server and works as above.

## Roles and audit

- **Who may create one:** editors and deployers, who may push. Readers see the link.
- **Audit:** each creation is in the audit log (`pull-request`), with the provider, the request's
  number and address, the branch and base, and whose account was used. Never a token.

## The API

For scripts and agents, with a session or `Authorization: Bearer <token>`:

| Call | Fields | Answer |
|---|---|---|
| `GET /api/git/pull-request` | | `available` (or the `reason` it isn't), `provider`, `as` (whose account), `via` (a CLI, on a workstation), `pushed`, the branch's open `request`, and a `title` and `body` to start from |
| `POST /api/git/pull-request` | **`title`** (required); `body`; `draft` (`true` or `false`, default `false`) | `ok` and the `request`, or the provider's `error` |
| `GET /api/credentials/git` | | the provider hosts of the server's projects, each with its projects and how your token is kept (`file`, `env:VAR`, `command`), or none |
| `POST /api/credentials/git` | **`host`**, **`store`**: `file` (with **`token`**), `env:VAR` or `command:<command>` (references: deployers only) | saved, or why not |
| `POST /api/credentials/git/remove` | **`host`** | forgotten |

For example, on the branch the token's session has open:

```bash
curl -s -X POST https://idm.example.com/api/git/pull-request -H "Authorization: Bearer $IDMWEB_AGENT" -H "Content-Type: application/json" -d '{"title":"Contractors to their own OU","body":"- placement: contractors\n- GCV contractor.ou","draft":true}'
```
