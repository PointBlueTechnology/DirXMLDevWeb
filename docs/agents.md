# Agents: Claude Code, Cursor, scripts

An agent works with DirXMLDevWeb the way a person does: through the same server, as a person, under
the same rules. Installing DirXMLDevWeb gives an agent everything installing DirXMLDev would: the CLI,
the simulator, the Identity Applications helper, the skills and docs of this version, and an MCP
server.

## Quick start

For Claude Code, on the machine where you run it (macOS, Windows or Linux; the commands are the
same in PowerShell):

1. **Make a token.** On the page, your name at the top right → **agent tokens…** → give it a label
   (`claude-laptop`) → *Make the token*. Copy the command it shows; the token is shown only once.
2. **Connect Claude Code** with that command. Add `--scope user` to have the server in every
   project, not only the folder you run it in:

   ```bash
   claude mcp add --scope user --transport http dirxmldev http://localhost:8080/mcp --header "Authorization: Bearer <your token>"
   ```

   On a team server, use its address (`https://idm.example.com/mcp`). `claude mcp list` should
   show `dirxmldev` as connected.
3. **Set it up.** In Claude Code:

   ```
   /mcp__dirxmldev__setup
   ```

   It reads the rules, installs the `dirxml-dev` and `dirxml-policy-testing` skills into
   `~/.claude/skills` (asking before it overwrites one), reads the agent docs, then tells you who
   it acts as, the branch, the drivers and what `validate` says. It changes nothing in the tree or
   a vault.
4. **Ask in your own words**: "why does the AD driver's placement policy put contractors in the
   wrong OU?", "add a GCV for the HR feed's URL and use it in the driver", "compare the tree with
   QA". The agent previews every edit before applying it, validates after, and shows you the plan
   before a deploy. A deploy, rollback or driver start or stop needs you to type the environment's
   name in the chat.

Another agent (Cursor, Codex, a script) connects to the same address with the same header; see
[Other clients](#other-clients). If it has no MCP prompts, the dialog's *Set up your agent* has the
setup text to paste into the chat. It holds no token.

## 1. Tokens

On the page, your name at the top right → **agent tokens…** → *Make the token*:

- **Label:** up to 60 characters, different from your other tokens' (`claude-laptop`,
  `cursor-work`). It names the token in the audit log.
- **Expires after:** 7, 30, 90 (the default), 180 or 365 days, up to what the server allows.

The token is shown once, with the command that connects Claude Code. The dialog lists your tokens
with when each was made, when it expires and when it was last used; **revoke** stops one at once.

An agent with your token **acts as you**: your roles (a reader's agent reads, an editor's edits, a
deployer's may deploy), your connections and vault credentials, your workspaces. Every call it makes
is in the audit log as yours, marked `via` the token's label; its commits are yours. An agent cannot
make or revoke tokens.

Only a SHA-256 of each token is kept (`users/<you>/agent-tokens.json` in the server's data folder,
owner-only), with who you were when you last used the page, so a change of your roles reaches your
tokens. On a team server, an administrator can turn personal tokens off (`agent.tokens=false`) or
shorten their longest life (`agent.tokens.maxDays`, default 365) in `hosted.properties`.

Agents that act for no one (CI) keep their own `agents=` entries in `hosted.properties`
([hosted-mode.md](hosted-mode.md)). The local install's `idmweb.env` holds one of those too
(`IDMWEB_AGENT_TOKEN`). For your own agent a personal token is better: the audit log then names you
and the token, and you can revoke it from the page.

## 2. MCP

The server is an MCP server at `/mcp`: Streamable HTTP, stateless, JSON answers (no server-sent
stream; `GET` answers 405). Every tool is a call to the server's own API, made with your token: the
same sign-in, origin check, roles, audit, per-environment write lock and production gate as the
page. Nothing in the MCP layer decides what an agent may do; the API does.

### What the agent works on

The agent works in **your workspace**: the same files the page shows you. Its first call opens the
project and branch you last had open on the page, and it stays on that branch while the server
runs; `session` says which. Edits it applies show on the page at once when you have that branch
open, and yours show to it.

To move the agent to another branch, open that branch on the page, then either make a new token
for the agent or restart the server (`docker restart idmweb` on the local install). Reconnecting
the agent with the same token keeps it where it was.

### Tools

Required arguments are in **bold**. Every tool answers with the API's JSON as text; a refusal comes
back as an error result with the server's reason. Answers longer than 200,000 characters are cut,
with a note: narrow the request (one driver, one path).

**Looking around** (any role):

| Tool | Arguments | What it does |
|---|---|---|
| `session` | | who you act as, your roles, the project and branch open, the versions |
| `outline` | | the tree: drivers, policies, resources, objects, and its revision |
| `read_artifact` | **`path`**: the tree path, as `outline` lists it (`drivers/AD/subscriber/sub-ctp`) | an artifact's content and details |
| `read_file` | **`file`**: a path in the tree (`drivers/AD/driver.xml`, `overrides/QA.properties`) | a file of the tree |
| `validate` | | the engine's own checks: compile, linkage, GCVs, mapping tables, filter, schema map |
| `fishbone` | **`driver`**: the driver's name | a driver's policy flow, policy set by policy set |
| `git_status` | | the branch, uncommitted files, unpushed commits, where it stands against the base branch |
| `git_diff` | `against`: `head` (default, the last commit) or `base` (the base branch) | what differs |

**Editing** (editor role):

| Tool | Arguments | What it does |
|---|---|---|
| `list_operations` | | every edit operation (`policy.add`, `gcv.set`, `driver.set`, `override.set`, …) and its arguments |
| `run_operations` | **`operations`**: a list of `{name, args, files}`, names and args as `list_operations` gives them; `files` maps an argument to file content, inline. `dryRun`: `true` (default) previews, `false` applies | one or more edits, applied together or not at all |
| `commit` | **`message`**; `push`: `true` to push too | commits the workspace's changes |

`run_operations` fetches the tree's revision itself, so an edit planned against an older tree is
refused instead of overwriting someone else's change. Example arguments:

```json
{"operations": [{"name": "gcv.set", "args": {"name": "hr.url", "value": "https://hr.example.com/api"}}], "dryRun": true}
```

**The vaults, reading** (any role; `env` is an environment's name, as `environments` lists it):

| Tool | Arguments | What it does |
|---|---|---|
| `environments` | | the project's environments, their tier (dev, test, prd), whether you are connected |
| `compare` | **`env`**; `drivers`: a list of the tree's driver names (all when omitted) | the tree against the vault: what a deploy would write |
| `compare_environments` | **`env`**, **`with`** | two vaults side by side: what only one holds, values that differ, likely renames, likely causes |
| `plan_deploy` | **`env`**; `drivers`; `restart`: `true` (default) restarts drivers a change needs restarted; `secrets`: `none` (default), `missing` or `all` | a deploy step by step, and what stands in its way |
| `driver_status` | **`env`**; `driver` | the drivers' state, or one driver's |
| `trace` | **`env`**, **`driver`** | a driver's recent trace |
| `snapshots` | **`env`** | the snapshots earlier deploys took (what a rollback puts back) |
| `simulate` | `env`: apply that environment's overrides | runs the project's simulator cases (`cases/`) against the tree |

**The vaults, writing** (deployer role). Each needs `confirm`: the environment's name, **typed by
you in the chat**. The agent must not fill it in itself.

| Tool | Arguments | What it does |
|---|---|---|
| `deploy` | **`env`**, **`confirm`**; `drivers`, `restart`, `secrets` as for `plan_deploy` | deploys, after a snapshot |
| `rollback` | **`env`**, **`snapshot`** (as `snapshots` lists it), **`confirm`** | puts a snapshot back |
| `driver_lifecycle` | **`env`**, **`driver`**, **`action`**: `start`, `stop` or `restart`; **`confirm`** | starts, stops or restarts a driver |

The server applies the page's rules to these: a production deploy comes from `main`, pushed and
current (unless the environment is set to deploy from any branch), validation errors block a
deploy, and one write per environment runs at a time. The agent reports a refusal; it doesn't work
around it.

### Resources and prompts

The server also gives the agent what it needs to know, so nothing has to be copied by hand:

- **Instructions**, when it connects: preview before applying, the plan before any vault write, you
  type the environment's name, production only from `main`, never a secret.
- **Resources:** this version's [agent kit](#4-the-agent-kit), with the server's MCP address filled
  in: `dirxmldev://kit/AGENTS.md` (the rules), `dirxmldev://kit/.claude/skills/…` (the two skills),
  `dirxmldev://kit/docs/…` (the agent guide, this page, the environment and git workflow docs).
- **Prompts:**

  | Prompt | Arguments | What it does |
  |---|---|---|
  | `setup` | `skills_dir`: where to install the skills (default `~/.claude/skills`; `.claude/skills` for one project) | reads the rules, installs the skills, reads the agent docs, then orients. Changes nothing |
  | `orient` | | who you act as and what you may do, the branch and its uncommitted work, the drivers, validation errors |

  In Claude Code they are `/mcp__dirxmldev__setup` and `/mcp__dirxmldev__orient`; an argument
  follows the name (`/mcp__dirxmldev__setup .claude/skills`).

Run `setup` again after an upgrade: the skills and docs are the server's version.

### Other clients

**Cursor:** `.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` for every project):

```json
{"mcpServers": {"dirxmldev": {"url": "http://localhost:8080/mcp", "headers": {"Authorization": "Bearer <your token>"}}}}
```

**Any client, or a script:** POST JSON-RPC 2.0 to `/mcp` with the header. For example, from a
shell with the token in `IDMWEB_AGENT`:

```bash
curl -s http://localhost:8080/mcp -H "Authorization: Bearer $IDMWEB_AGENT" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"validate","arguments":{}}}'
```

The answer is `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"…"}],"isError":false}}`,
with the API's JSON in `text`. `initialize`, `tools/list`, `resources/list`, `resources/read`,
`prompts/list` and `prompts/get` work the same way. Protocol versions 2025-06-18, 2025-03-26 and
2024-11-05 are accepted.

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

Wherever a skill or doc says `bin/idm`, `bin/sim` or `bin/apps`, an agent on that machine runs these
instead. An agent on another machine uses MCP.

## 4. The agent kit

The rules, skills and docs of this version, for any agent that reads `AGENTS.md` or skills:

- `AGENTS.md` (and `CLAUDE.md`, which imports it): how to connect, and the rules;
- `.claude/skills/dirxml-dev/`: editing, validating, simulating and deploying a driver set;
- `.claude/skills/dirxml-policy-testing/`: testing and debugging policies with the simulator;
- `docs/`: the agent guide, this page, and how work moves between branches and environments.

Three ways to get it, all the same files:

- over MCP, as resources: the `setup` prompt installs the skills from them;
- the local install's `setup` writes it to `agent/` in your `idmweb` folder, and refreshes it on
  every upgrade: start Claude Code there, or copy `agent/.claude/skills` to `~/.claude/skills`;
- on any server, *agent tokens…* → *Download the agent kit* gives it as a zip with that server's
  MCP address.

## When something goes wrong

| What you see | Why, and what to do |
|---|---|
| `claude mcp list` shows `dirxmldev` failed, or every call answers 401 | the token is wrong, expired or revoked (the dialog shows an expired one). Make a new one, then `claude mcp remove dirxmldev` and add it again |
| `sign in first` | the request carried no token: check the `--header` part of the command |
| the agent is on the wrong branch | it opened the one you last had open: see [What the agent works on](#what-the-agent-works-on) |
| an edit is refused because the tree moved | the tree changed after the agent read it (you on the page, perhaps): the agent reads it again and repeats the preview |
| `deploy` is refused | the reason names the rule: no deployer role, `confirm` isn't the environment's name, validation errors, a production deploy that isn't from `main` pushed and current, or another write to that environment running. Fix the cause; the agent must not route around it |
| a compare or plan says you aren't connected | your sign-in for that vault is missing or needs a new password: *Connections* on the page |
| an answer ends with `cut at 200000 characters` | ask for less: one driver (`drivers`), one artifact (`read_artifact`) |
| the skills are older than the server | run `/mcp__dirxmldev__setup` again after an upgrade |

## What stays on a workstation

A container can't hold what lives on the desktop: Designer, the vendor form builder, the VS Code
extension's views of local files, and macOS Keychain references for secrets (the container keeps
secrets in its own files, environment variables or command references). Install DirXMLDev on the
workstation for those; it works on the same repository.
