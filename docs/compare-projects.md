# Compare projects and promote

Some teams keep one project per environment: a QA project and a production
project, each with its own repository, each deployed only to its own vault.
**Compare projects** shows what differs between this project and another one.
It promotes the differences you choose into a new branch of this project, for
review like any other change.

The design is [project-per-environment.md](project-per-environment.md). The
command line underneath is DirXMLDev's `tree.compare` and `promote.*`
([promotion.md](https://github.com/PointBlueTechnology/DirXMLDev/blob/master/docs/promotion.md)).

The one-project model, with `overrides/<env>.properties` and a branch merged and
deployed to each environment in turn ([git-workflow.md](git-workflow.md)), works
as before.

## The first time through

With a QA project and a production project on the server, QA's work merged into its `main`:

1. Open a branch of **production** (its `main` is fine), and choose **Compare projects**, then
   **Compare with: acme-qa** and **Compare**.
2. **Pair with acme-qa…**: check the proposed map (drivers and servers QA names differently),
   **Compare with this map**, and set what to leave pending or accept as known. **Pair** opens a
   branch with the map and the first record: merge it as any other change (the pull request, or
   **Merge into main…**).
3. From then on, **Compare** lists what QA changed since as *pending*, ticked. Look at each file
   side by side, keep production's lines where you need to, and **Promote**. Review the branch,
   merge it, and deploy production as usual.

## Where it is

**Compare projects** in the left-hand menu, on a server that holds more than one
project. Open a branch of the project you want to change (the target, such as
production), then pick the project to compare it with (the source, such as QA).

## What is compared

- **The base branches, as each repository has them.** Both projects' `main` (or
  their configured base) are fetched for every comparison. The branch you have
  open doesn't matter, and neither does anything uncommitted or unpushed. What
  you review is what a promotion applies.
- **In this project's terms.** The source's driver names and servers go through
  the pair's map, `promotions/<source>.properties` in this project's tree. The
  driver set's name and DN, and each driver's DN, are always this project's. The
  page proposes map lines for drivers that look alike under other names.
- **Files with their values set aside.** A value that differs (a GCV, a shim
  parameter, the authentication server) never makes its file look changed.
  Values are listed on their own, marked **V**.

## Reading the list

Differences are grouped by driver, with the driver set and the Library first.
Each one has a bucket, worked out from the pair's promotion record
(`promotions/<source>.json`):

| Bucket | Means | Ticked to begin with |
|---|---|---|
| **pending** | the other project changed it since the last promotion | yes (files) |
| **both changed** | both projects changed it: compare the two | no |
| **this project's own** | only this project changed it | no |
| **not paired yet** | the pair has no record of it: a plain difference | no |
| **known**, **unchanged since the record** | accepted as it is, or neither side changed it: hidden behind *show N known or unchanged* | no |

A value is never ticked to begin with: values stay this project's unless you
tick them.

A file marked **A** is only in the other project, **D** only in this one, **M**
in both, differently.

Pick a file to see it side by side. The left side is this project now. The right
side is what promoting writes: the other project's file, with this project's
values. To keep some of this project's lines, use the arrow beside a block, or
edit the right side. The file is then marked *merged* and promoted as you left
it.

## Promoting

Tick what to move, then **Promote N file(s)…**:

1. **A new branch** of this project is made from its base, named
   `promote/<source>-<yyyyMMdd-HHmmss>` (UTC).
2. **The ticked files are written into it**, with this project's values kept
   except the ones you ticked. Each promoted file's package baseline goes with
   it.
3. **The result is validated.** It is refused, and no branch is made, when:
   - it would add a validation error;
   - a file you add or remove needs its manifest promoted too (the driver's
     `driver.xml`, `library/library.xml` or `driverset.xml`). The page warns
     about this before you promote.
4. **It is committed as you and pushed.** The commit message lists what moved and
   ends with `Promoted-from: <source>@<the source's commit>`. The promotion
   record goes in the same commit.
5. **The page opens the branch** on *Changes, vs main*. From the bar, create the
   pull request (GitHub, GitLab) or **Merge into main…**. Deploying goes through
   Compare, Plan and Deploy as for any other change.

If either base branch moves between your comparison and **Promote**, nothing is
written and you are asked to compare again.

Promoting is partial by design: whatever you leave unticked stays pending for
the next time.

## Who may

| | Readers | Editors | Deployers |
|---|---|---|---|
| Compare | yes | yes | yes |
| Promote (make the branch) | no | yes | yes |
| Merge, deploy | as for any branch | | |

## Pairing

Until a pair has a record, every difference shows as *not paired yet*. A promotion records only
what it moved. **Pair with <project>…** (in the notice above the list, for editors) takes the first
record, so from then on only new changes show:

1. **The map.** The page shows `promotions/<project>.properties` as the file holds it. With no
   file yet, it proposes one:
   - a `drivers/<their name>.name = <this project's name>` line for each driver that looks like
     one only this project has (the same shim, a similar name, policies in common);
   - when the two projects' servers differ, each of their servers onto the one here with the
     nearest name.

   Edit it, then **Compare with this map** to see the differences it leaves.
2. **Each difference** is taken as it is unless you choose otherwise:
   - **leave pending**: it shows as pending, to promote;
   - **known**: accepted as it is.
3. **Pair** writes the map (as you wrote it, comments included), the record and the known
   differences into a new branch, `promote/<project>-pair-<time>`. It commits them, pushes, and
   opens the branch for review, like a promotion.

After a change to the map (a driver renamed), pair again: the record names files by this
project's paths.

## Known differences

Pick a difference to see, above it, **accept as known: intended** (different on purpose) or **to
decide later**. A known difference picked from *show N known or unchanged* offers **no longer
known**. The decisions go into `promotions/<project>.known.json` with the next promotion, or on
their own (**Record N decision(s)…**), in a new branch, the same way. A known difference stays
collapsed until either project changes it, and then shows again, marked *changed since known*.

## Cases

When both projects have simulator cases (each project's `cases` directory), each case's files
compare as `cases/<path>`, under the driver its `case.properties` names (`driver=`, read as this
project names the driver). Ticked and promoted like any file, a case's `driver=` is written with
this project's name for the driver.

## Agents

`compare_projects` and `promote_changes` do the same over MCP ([agents.md](agents.md)). An agent
may prepare a promotion branch and offer you the pull request. Merging and deploying are yours.

## The API

With a session or `Authorization: Bearer <token>`. Both calls act on the branch
the session has open, and through it on that branch's project.

| Call | Who | Fields | Answer |
|---|---|---|---|
| `GET /api/promote/projects` | anyone signed in | | `project`, `base`, `inPlace`, and `projects`: the others, each with `name` and `base` |
| `GET /api/promote/compare` | anyone signed in | **`from`**: another project's name; `map`: a map's text to compare with instead of the pair's file | `pair`; `target` and `source` (each `project`, `base`, `commit`); `paired`; `map` (whether the pair has a map file); `cases` (whether both have cases); `revision`; `items`; `matches`; `notes` |
| `GET /api/promote/compare?brief=true` | anyone signed in | **`from`** | the same without both sides' texts: each file's changed lines (`detail`) instead |
| `GET /api/promote/map` | anyone signed in | **`from`** | `file` (the map's path), `current` (its text, or null) and `proposed` (a map to start from) |
| `POST /api/promote/apply` | editors, deployers | **`from`**; **`revision`** (from the comparison); `objects` (file paths, or `drivers/<name>` with its cases); `values` (value keys); `contents` (`{"<path>": "<merged text>"}`, which chooses that file too); `known` (`{"<path>": {"decision": "intended" or "later", "note": "…"}}`); `forget` (paths no longer known); `dryRun` (`true` checks, makes no branch). At least one of them | `ok`; then `branch`, `hash`, `pushed`, `trailer`, `title`, `promoted`, `values`, `known`, `forget`, `changedFiles`, `deletedFiles`; or `refusal` and `newErrors` |
| `POST /api/promote/pair` | editors, deployers | **`from`**; **`revision`** (from a comparison made with the same `map`); `map` (the map file's text, written as it is; omit to keep the pair's file); `pending` (paths left pending); `known` (as above) | `ok`, `branch`, `hash`, `pushed`, `notes`; or `refusal` |

Each item of a comparison has:

- `path`: the file's tree path, or the value's overrides key.
- `kind`: `file` or `value`.
- `driver`: this project's name for it, or null.
- `bucket`: `pending`, `own`, `both`, `known`, `unchanged` or `unpaired`.
- `state`: `differs`, `only in the source` or `only in the target`.
- `changedSinceKnown`.
- A file adds `before` and `after` (text, null when that side has none), or
  `binary`, and its `language`.
- A value adds `source` and `target`.

A stale `revision` gets a 409: compare again. A project used as a checkout in
place can be compared but not promoted into; there, use `bin/idm promote.apply`.

For example, from an agent with a token:

```bash
curl -s "https://idm.example.com/api/promote/compare?from=acme-qa" -H "Authorization: Bearer $IDMWEB_AGENT" > compare.json
curl -s -X POST https://idm.example.com/api/promote/apply -H "Authorization: Bearer $IDMWEB_AGENT" -H "Content-Type: application/json" \
  -d "{\"from\":\"acme-qa\",\"revision\":\"$(jq -r .revision compare.json)\",\"objects\":[\"drivers/AD/subscriber/sub-ctp.policy.xml\"]}"
```

Each promotion and each pairing, made or refused (a stale review and a dry run are not), is in the
audit log as `promote` or `promote-pair`, with the source project, its commit, what was chosen, and
the branch made.
