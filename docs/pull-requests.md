# Pull requests through the provider's API: design note (#35)

Status: **decided 2026-10-13** (section 6): the recommendations, all four. P1 next.

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
