# Pull requests through the provider's API: design note (#35)

Status: **decided 2026-10-13** (section 6): the recommendations, all four. **P1, P2 and P3 built** (sections 8–10): #35 complete.

## 1. Today

The repository bar shows *Pull request ↗* once a branch differs from the base. It is a link to
the provider's compare page (`Git.compareUrl`): GitHub's `/compare/<base>...<branch>`, GitLab's
`/-/merge_requests/new`. The person leaves the app, signs in to the provider and fills the form
there. Any other host gets no link at all.

What the server already has:

- **The project's repository token** (`repo.token`, `project.<name>.repo.token`, or a
  `*.tokenCommand` / `*.tokenKeychain` reference). The server pushes with it over https.
- **Each person's own file** (`data.dir/users/<subject>/`, docs/multi-user.md). Today it holds
  their vault credentials by environment, and nobody else reads it.
- **Who is asking.** The signed-in person's name and email, and the editor and deployer roles.

## 2. What it does

1. On a branch that differs from the base, *Create pull request…* opens a short dialog:
   - a title, defaulting to the branch's last commit subject;
   - a body, defaulting to the branch's commit subjects as a list;
   - the base branch (the project's), and a *draft* tick.
2. *Create* calls the provider's API. The bar then shows the request as a link with its
   number and state, e.g. *#12 open ↗*, instead of the create button.
3. When the branch already has an open request, the bar shows that one, and no second one is
   offered. On a page load the bar asks the provider for the branch's open request.
4. A push to the branch updates the request as usual, since the provider follows the branch.
5. The compare link stays as the fallback. It covers a host the server cannot reach or has no
   credential for, and a provider it does not speak.

| Provider | Create | The branch's open request |
|---|---|---|
| GitHub (github.com; Enterprise at `https://HOST/api/v3`) | `POST /repos/{owner}/{repo}/pulls` with `title`, `head`, `base`, `body`, `draft` | `GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=open` |
| GitLab (gitlab.com; self-managed at `https://HOST/api/v4`) | `POST /projects/{url-encoded path}/merge_requests` with `source_branch`, `target_branch`, `title` (a draft is a `Draft:` prefix), `description` | `GET /projects/{path}/merge_requests?source_branch={branch}&state=opened` |

The provider and the API's address are inferred from the remote: `github.com`, or a host whose
name contains `gitlab`. A project can name them instead:

```properties
project.<name>.repo.provider=github        # github | gitlab
project.<name>.repo.apiUrl=https://git.example.com/api/v3
```

The call goes out through the server's TLS trust, the same trust the sign-in uses, so a
self-hosted provider with a private CA works when its root is trusted.

## 3. Whose credential

A pull request is created **as someone**. The provider records that account as its author and
sends the notifications.

| Option | Author on the provider | What people must do | Notes |
|---|---|---|---|
| A. the project's repository token | the token's account (a bot or service user) | nothing | the body ends with "Opened by Alice Example from DirXMLDevWeb" |
| B. each person's own provider token | the person | each adds a token to their own file, once | tokens with *pull requests: write* (GitHub) or *api* (GitLab) |
| C. B when the person has one, else A | the person, or the bot | optional | **recommended** |

With C, *My connection* gains one field, *Your Git provider token*. It is stored write-only in
the person's own file, like their vault password, and can be a secret-manager reference. The
dialog says which account will be the author before *Create*.

The project token must allow it. On GitHub that is *Pull requests: read and write* on top of
*Contents* for the push. On GitLab it is the *api* scope. A token without it gets the provider's
own answer back, shown as it is, and the compare link is offered.

## 4. Local installs

A workstation install has no repository token. Its pushes use the person's own git credentials.
Two ways to create a request there:

- **The provider's CLI**: `gh pr create` or `glab mr create`, when one is installed and signed
  in (`gh auth status`). It uses the person's existing sign-in and stores nothing new.
  **Recommended.**
- A token in the Keychain (`IDMWEB_GIT_TOKEN`, or a `--git-token-keychain` flag).

Without either, the compare link stays.

## 5. Roles, audit, failure

- **Roles.** Editors may create a request, since they may push. Readers see the link.
- **Audit.** Each creation is recorded: the provider, the request number and URL, the base and
  the branch, the account used (bot or person), and the outcome. A token never is.
- **Failure.** The provider's message is shown, e.g. "A pull request already exists" or "Not
  Found" for a token that cannot see the repository, and the compare link is offered.
- **Not in this change.** Reviewers, labels, assignees, merging from the page, Azure DevOps and
  Bitbucket.

## 6. Decisions needed

1. **Whose credential** (section 3): A, B, or C? (Recommended: C.)
2. **Providers in version one**: GitHub and GitLab together, or GitHub first and GitLab
   second? (Recommended: together. They differ only in two calls.)
3. **Local installs** (section 4): the provider's CLI, a Keychain token, or the compare link
   only? (Recommended: the CLI.)
4. **Draft by default?** (Recommended: no; the tick is there.)

Decided 2026-10-13 (Jerry: "Go with the recommendations"):

1. **C**: the person's own provider token when they have one, otherwise the project's repository
   token, with "Opened by …" in the body.
2. **GitHub and GitLab together**, self-hosted included.
3. **Local installs through the provider's CLI** (`gh` / `glab`) when it is installed and signed in.
4. **Not a draft by default**; the tick is there.

## 7. Phases

| Phase | What | Needs |
|---|---|---|
| P1 | `PullRequests` (GitHub and GitLab clients, provider detection), `POST /api/git/pull-request`, `GET /api/git/pull-request`, the dialog and the bar's link, audit | decisions 1–2 |
| P2 | the person's provider token in *My connection* (if C or B) | P1, decision 1 |
| P3 | local installs through `gh` / `glab` (if chosen) | P1, decision 3 |

Each phase is tested against a stub provider in the unit tests and the smoke run. P1 is also
checked against this repository on GitHub with a scratch branch, whose request is closed
afterwards.

## 8. As built (P1)

- `PullRequests` (web): GitHub and GitLab clients and the provider detection. `repo.provider`,
  `repo.apiUrl` and `repo.caFile` (else `oidc.caFile`) are the project's settings.
- `GET /api/git/pull-request` answers `available` (or the `reason` it is not), the `provider`, whose
  account it would be created `as`, whether the branch is `pushed`, the branch's open `request`, and
  a `title` and `body` to start from. `POST /api/git/pull-request` takes `title` (required), `body`
  and `draft`, needs an editor and a pushed branch, and answers `ok` with the `request`, or the
  provider's `error`. Each creation is audited (`pull-request`), without the token.
- The bar asks only when the branch, its upstream or its unpushed count changes. It shows the open
  request as `#12 open ↗` (`!12` on GitLab), else *Create pull request…* (disabled until pushed),
  else the compare link.
- Found on the way: a workspace is a single-branch clone, so a push of its own branch never
  recorded `origin/<branch>` (no "to push" count, no upstream). A workspace now tracks its own
  branch when it is opened and before each push.
- Tested: `PullRequestsTest` against a stub of each provider, the hosted smoke against a stub
  GitHub (fallback, create, the open one shown, audit, the description's "Opened by" line), the
  page against the same stub, and the client against this repository on GitHub (a scratch draft
  request, closed and its branch deleted).

## 9. As built (P2)

- `GitTokens`: a person's provider tokens in `data.dir/users/<subject>/git.properties` (owner-only),
  by host: `<host>.token` (kept in that file), `<host>.tokenEnv`, `<host>.tokenCommand` (a secret
  manager's CLI, through the same picker as a vault password). Write-only: nothing gives a value back.
  A command (or secret manager) reference is a deployer's (2026-10-14): an editor's is refused when
  saved, and one already in their file is never run (the project's token stands in, with the reason).
- `GET /api/credentials/git` lists the provider hosts of the server's projects, with each host's
  projects and how the person's token is kept (`file`, `env:VAR`, `command`) or none.
  `POST /api/credentials/git` takes `host`, `store` (`file` with `token`, `env:VAR`, `command:…`);
  `POST /api/credentials/git/remove` takes `host`. Both are audited with the host and the form,
  never the value. Any signed-in editor manages their own.
- A pull request uses the person's token for the remote's host when there is one: the request is
  theirs on the provider and the description carries no "Opened by" line. A token that cannot be
  read (an unset variable, a failing command) falls back to the project's, and the dialog says why.
- The page: *My Git provider tokens* under *My connections* (Add, Replace, Forget), and the dialog
  points there when the project's token would be used.
- Tested: `GitTokensTest` (forms, the owner-only file, refusals, the host list, no value given back),
  the hosted smoke (her token used and sent, no "Opened by", the fallback with its reason, forget,
  the audit without values), and the page against a project on a GitHub-style remote.

## 10. As built (P3)

- `CliPullRequests`: on a local install the remote's provider names the CLI, `gh` for GitHub and
  `glab` for GitLab, found on `PATH` or in the usual install places (Homebrew included, for a server
  started from a launcher). `gh auth status --hostname <host>` (or `glab`'s) says whether it is
  signed in; its account is the author ("jcombs (through gh)"). It runs in the checkout, prompts and
  pagers off: `gh pr list --head <branch> --state open --json …`, `gh pr create --base --head
  --title --body [--draft]`; `glab mr list --source-branch <branch> --output json`, `glab mr create
  --source-branch --target-branch --title --description [--draft] --yes`. Nothing is stored.
- The same routes as on a hosted server: `GET /api/git/pull-request` answers `via` (the CLI) and, when
  it cannot be used, the reason with what to run (`gh auth login --hostname <host>`). The base is
  `main` or `master`, whichever the remote has. No "Opened by" line: the request is the person's.
- Tested: `CliPullRequestsTest` against stub `gh` and `glab` scripts (the calls made, signed out,
  missing, the CLI's own error), the local smoke (a tree outside a checkout), and the page against
  this repository through the real `gh`: a scratch draft request (#104), closed and its branch deleted.
