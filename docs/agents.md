# Agents: Claude Code, Cursor, scripts

An agent works with DirXMLDevWeb the way a person does: through the same server, as a person, under
the same rules. Installing DirXMLDevWeb gives an agent everything installing DirXMLDev would: the CLI,
the simulator, the Identity Applications helper, the skills and docs of this version, and an MCP
server.

## 1. A token

On the page, your name at the top right → **agent tokens…** → *Make the token*. Give it a label
(`claude-laptop`) and a lifetime (90 days by default). The token is shown once, with the command
that connects Claude Code.

An agent with your token **acts as you**: your roles (a reader's agent reads, an editor's edits, a
deployer's may deploy), your connections and vault credentials, your workspace of the branch you have
open. Every call it makes is in the audit log as yours, marked `via` the token's label; its commits
are yours. Revoke a token from the same dialog; it stops working at once. An agent cannot make or
revoke tokens.

Only a SHA-256 of each token is kept (`users/<you>/agent-tokens.json` in the server's data folder,
owner-only), with who you were when you last used the page, so a change of your roles reaches your
tokens. On a team server, an administrator can turn personal tokens off (`agent.tokens=false`) or
shorten their longest life (`agent.tokens.maxDays`, default 365) in `hosted.properties`.

Agents that act for no one (CI) keep their own `agents=` entries in `hosted.properties`
([hosted-mode.md](hosted-mode.md)).

## 2. MCP

The server is an MCP server at `/mcp` (Streamable HTTP, stateless). With Claude Code:

```bash
claude mcp add --transport http dirxmldev http://localhost:8080/mcp --header "Authorization: Bearer <your token>"
```

Use your server's address for a team server (`https://idm.example.com/mcp`). Keep the token in an
environment variable rather than in a file you commit.

Every tool is a call to the server's own API, made with your token: the same sign-in, origin check,
roles, audit, per-environment write lock and production gate as the page.

| Tool | What it does |
|---|---|
| `session` | who you act as, your roles, the project and branch open, the versions |
| `outline` | the tree: drivers, policies, resources, objects, and its revision |
| `read_artifact`, `read_file` | an artifact's content by tree path; a file of the tree |
| `validate` | the engine's own checks over the tree |
| `fishbone` | a driver's policy flow |
| `git_status`, `git_diff` | the workspace against the last commit or the base branch |
| `list_operations` | every edit operation and its arguments |
| `run_operations` | edit the tree: preview (the default), then apply |
| `commit` | commit, and push |
| `environments` | the environments, their tier, whether you are connected |
| `compare` | the tree against an environment's vault |
| `compare_environments` | two environments' vaults side by side |
| `plan_deploy` | a deploy step by step, and what stands in its way |
| `driver_status`, `trace`, `snapshots` | drivers' state, a driver's trace, the snapshots |
| `simulate` | run the project's simulator cases |
| `deploy`, `rollback`, `driver_lifecycle` | vault writes: need the deployer role, and the environment's name typed by the person as `confirm` |

The server tells the agent the rules when it connects: preview before applying, the plan before any
vault write, the person types the environment's name, production only from `main`, never a secret.

It also serves this version's [agent kit](#4-the-agent-kit) as MCP **resources**
(`dirxmldev://kit/AGENTS.md`, `dirxmldev://kit/.claude/skills/…`, `dirxmldev://kit/docs/…`), and two
**prompts**:

- `setup`: read the rules, install the skills (into `~/.claude/skills` unless you give `skills_dir`;
  it asks before overwriting), read the agent docs, then orient. Nothing is changed in the tree or a
  vault.
- `orient`: who you act as, the project and branch, what `validate` says, what is uncommitted.

### Set up your agent

After `claude mcp add`, in Claude Code:

```
/mcp__dirxmldev__setup
```

Agents that don't offer MCP prompts can be given the same text: *agent tokens…* → *Set up your
agent* → *Copy*, and paste it into the chat. It holds no token.

## 3. The CLIs

On the machine that runs the container (the local install), the CLIs run in your workspace of the
first project's branch `main`:

```bash
docker exec idmweb idm validate tree
```

```bash
docker exec idmweb sim
```

```bash
docker exec idmweb apps --env lab tasks
```

`-e IDMWEB_BRANCH=feature/x` picks another branch, `-e IDMWEB_PROJECT=<name>` another project.
Paths are the container's: use paths relative to the workspace (`tree`, `cases`). On Windows, Git
Bash rewrites arguments that look like Unix paths; prefix `MSYS_NO_PATHCONV=1` for an absolute one.

## 4. The agent kit

The rules, skills and docs of this version, for any agent that reads `AGENTS.md` or skills:

- `AGENTS.md` (and `CLAUDE.md`, which imports it): how to connect, and the rules;
- `.claude/skills/dirxml-dev/`: editing, validating, simulating and deploying a driver set;
- `.claude/skills/dirxml-policy-testing/`: testing and debugging policies with the simulator;
- `docs/`: the agent guide, this page, and how work moves between branches and environments.

The local install's `setup` writes it to `agent/` in your `idmweb` folder, and refreshes it on every
upgrade; start Claude Code there, or copy `agent/.claude/skills` to `~/.claude/skills` to have the
skills everywhere. On any server, *agent tokens…* → *Download the agent kit* gives it as a zip with
that server's MCP address.

## What stays on a workstation

A container can't hold what lives on the desktop: Designer, the vendor form builder, the VS Code
extension's views of local files, and macOS Keychain references for secrets (the container keeps
secrets in its own files, environment variables or command references). Install DirXMLDev on the
workstation for those; it works on the same repository.
