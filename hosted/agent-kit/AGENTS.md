# Working on this IDM project with an agent

This folder is the agent kit of a DirXMLDevWeb {{VERSION}} server: the rules, the skills and the docs
for this version, for Claude Code, Cursor, Codex or any agent that reads `AGENTS.md`. An agent works
through the same server people use, as one of them, under the same rules.

## Connect

**MCP (preferred).** The server is an MCP server at `{{MCP_URL}}`. Make a token on the page (your
name at the top right → *Agent tokens…*); the agent then acts as you: your roles, your connections,
your workspace of the branch you have open. For Claude Code:

```
claude mcp add --transport http dirxmldev {{MCP_URL}} --header "Authorization: Bearer <your token>"
```

Keep the token out of chats and files you commit: put it in an environment variable and refer to it.

**The CLIs, on the machine that runs the container:** `docker exec idmweb idm …` (DirXMLDev),
`docker exec idmweb sim …` (the policy simulator), `docker exec idmweb apps …` (Identity
Applications). They run in your workspace of the first project's branch `main`;
`docker exec -e IDMWEB_BRANCH=feature/x idmweb idm …` picks another branch,
`-e IDMWEB_PROJECT=<name>` another project. Paths are the container's: use paths relative to the
workspace (`tree`, `cases`). Wherever a skill or doc below says `bin/idm`, `bin/sim` or `bin/apps`,
run these.

## The rules

1. Orient first: `session`, `outline`, `validate` (or `idm validate tree`). `idm` with no arguments,
   or `list_operations`, is the list of what exists; never invent a flag or an operation.
2. Edit the tree with operations (`run_operations`, or `idm <operation> tree …`); preview before
   applying; validate after.
3. Before any vault write, show the person the plan (`plan_deploy`, or `idm vault.deploy tree --env E
   --dry-run`) and wait for a yes. A deploy, rollback or driver start/stop needs the environment's name,
   typed by the person in chat. Never fill it in yourself.
4. Production deploys come from `main`, pushed and current. Never work around a refusal: report it.
5. Never print a secret. Tools and the CLI never show one; don't look for them.
6. Commit with a message that says why; never commit secrets, exports or client data.

## What's here

- `.claude/skills/dirxml-dev/`: editing, validating, simulating and deploying a driver set
  (DirXMLDev).
- `.claude/skills/dirxml-policy-testing/`: testing and debugging policies with the simulator.
- `docs/agent-guide.md`: the edit loop and its refusals, in full.
- `docs/agents.md`: this server for agents: the MCP tools, tokens, what each may do.
- `docs/environment-practices.md` and `docs/git-workflow.md`: how work moves between branches and
  environments.
