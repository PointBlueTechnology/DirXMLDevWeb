# A project per environment: design note

Status: **proposed 2026-10-26; decisions needed (section 8).** Nothing here is built.

The question: can each environment be a project of its own (a QA project, a production project),
with a way to compare two projects and move differences from one to the other? This is how many
Identity Manager teams already work in Designer, with one project per environment, and it is
what a team taking on existing environments usually finds.

The answer: yes, as a second model beside the current one. Comparing two projects needs little new
code. What makes moving changes between them safe is a **promotion record**: two separate
repositories share no history, so without one, nothing can tell a change made in QA from a change
made in production, or from a difference that is meant to be there.

## 1. The two models

| | One project, every environment (today) | A project per environment (proposed) |
|---|---|---|
| The tree | one, deployed to every environment | one per environment, each deployed only to its own (`project.<name>.environments`) |
| What differs per environment | `overrides/<env>.properties`: values, driver names, server roles, jobs; the per-object `environments` and `planned` lists ([existing-environments.md](https://github.com/PointBlueTechnology/DirXMLDev/blob/master/docs/existing-environments.md) in DirXMLDev) | each tree simply holds its environment's own values, names and servers |
| How a change moves | a branch, merged into `main`, deployed to each environment in turn ([git-workflow.md](git-workflow.md)) | promoted: compared, picked and copied into the next project, reviewed there, then deployed |
| What git knows | one history: a merge carries only what changed | two histories with nothing in common: the promotion record stands in |
| Drift | possible only on purpose (an override, a known difference) | the default: every shared change has to be promoted, or the projects diverge |
| Who may change production | the production gate on `main` | the production project's own roles and repository |

Both stay. A project picks its model; nothing about the first changes.

## 2. How people would work

Two projects, `acme-qa` and `acme-prod`, each with its own repository, deployed to QA and to
production respectively.

1. **Work in QA as today.** Branch in `acme-qa`, edit, validate, deploy to QA, test, and merge into
   `acme-qa`'s `main`.
2. **Compare with production.** In `acme-prod`, open *Compare with project → acme-qa*. The page lists
   what differs, sorted into the buckets of section 4: *pending* (changed in QA since it was last
   promoted), *production's own*, *both changed*, and *known* (meant to differ, set aside).
3. **Promote.** Tick what to move: whole drivers or objects, files, or lines, in the same review as
   *Update this branch from <environment>…*. The page writes them into a new branch of `acme-prod`
   (`promote/acme-qa-<date>`). Names and servers are translated on the way, the result is validated,
   and it is committed with the promotion record. Where the repository has GitHub or GitLab in front,
   a pull request is opened.
4. **Deploy production as today**, from `acme-prod`'s `main` once the branch is merged, with the
   same plan, typed confirmation and production gate.

## 3. Comparing two projects

Most of this exists:

- **The diff.** `ModelDiff` (DirXMLDev, behind `idm tree.diff <a> <b>` and `vault.diff`) already
  compares two trees object by object, canonically, so formatting never shows as a change.
- **Names and servers.** Each project's tree uses its own environment's driver names and server
  DNs. The comparison needs a map between them for each pair of projects:
  - which source driver is which target driver;
  - which source server plays which target server.

  `EnvironmentCompare` already proposes driver matches (by shim class, name and policies in common)
  and server maps for two vaults; the same logic applies to two trees. The map is kept in the
  target project, `promotions/<source>.properties`:

  ```properties
  # in acme-prod: promotions/acme-qa.properties, in the overrides file's form (split at the first =)
  drivers/HR Feed QA.name = HR Feed
  servers.vault01qa = cn=vault01,ou=servers,o=acme
  ```

- **Known differences.** The same form as `overrides/<env>.known.json` (path, a fingerprint of both
  sides, the decision, who, when), kept per pair: `promotions/<source>.known.json`. A value that must
  differ (a URL, a container DN in a placement policy) is accepted once and stays out of the list
  until either side changes it.
- **The view.** Vault → Environments' layout, by driver with likely causes, reading two trees
  instead of two vaults. Nothing is read from a vault, so it's fast, and it works offline.

## 4. The promotion record

The piece that doesn't exist yet. Each promotion records, **per object it moved**, a fingerprint of
the object as the source had it and as the target had it afterwards. The fingerprint is the
canonical one known differences use. The record lives in the target project with the map,
`promotions/<source>.json`, and is committed with the promotion. The commit also carries a trailer,
`Promoted-from: acme-qa@<commit>`, so the history says where each change came from.

With it, each difference sorts itself, object by object:

| Source since the record | Target since the record | Bucket |
|---|---|---|
| changed | unchanged | **pending**: waiting to be promoted |
| unchanged | changed | **the target's own**: left alone unless ticked |
| changed | changed | **both changed**: shown side by side to settle, as a merge conflict is |
| — | — | in `known.json`: **known**, collapsed |
| no record yet | | **not paired yet**: shown as a plain difference (section 5, *Pairing*) |

Per object, not per commit, so a partial promotion is fine: promoting two of five pending drivers
leaves the other three pending. It doesn't depend on git history, so it works the same for two
repositories, two branches or two directories.

## 5. Moving changes

- **Pairing.** The first comparison of two projects has no record, so every difference is shown
  plain. A guided *Pair with acme-qa…* is like *Set up <environment>…*:
  - it proposes the driver and server map;
  - it proposes which differences are intended (known);
  - it records the rest as already in step.

  From then on only new changes show. It is reviewed before anything is written, then committed.
- **Choosing.** Tick per object, per file, or within a file line by line, as *Update this branch
  from <environment>…* does today. Nothing is ticked by default in the target's own or both-changed
  buckets. Values follow the target unless ticked: a promoted policy brings its logic, not QA's URL.
- **Translating.** Driver names and server DNs go through the pair's map. Nothing else is rewritten.
  A DN inside a policy that differs per environment is a known difference or a GCV, not something to
  guess.
- **Writing.** Through the core's operations, so the target's validation runs and a promotion that
  would not validate is refused with the reason. The promotion lands on a new branch, never on
  `main`, with the record updated in the same commit. A pull request is opened when the provider
  allows. Cases (`cases/`) can be promoted the same way, so the regression corpus moves with the
  change.
- **Deleting.** An object removed in the source since the record is offered as a removal in the
  target, unticked by default.
- **Audit.** `promote` lines: the pair, the objects, the source commit and the branch made.

## 6. Agents

Two MCP tools on the same API and the same rules as the page:

- `compare_projects`: **`with`** (the source project); answers the buckets.
- `promote_changes`: **`from`**, **`objects`**; `dryRun` (default true). It previews, then writes the
  branch.

An agent may prepare a promotion branch and open the pull request. Merging and deploying stay the
person's: the production gate and the typed environment name apply as for any deploy.

## 7. Alternatives considered

- **A branch per environment in one repository** (`env/qa`, `env/prod`). Git's history is shared,
  so a merge is a real three-way merge, and *Merge into main…* and conflict resolution apply as
  they are. But values that must differ sit in the same files and conflict on every merge, which
  is why the current model moved them into overrides. With overrides it is close to today's model.
  The promotion record of section 4 would work here too.
- **Copying trees by hand** (export one, import into the other). Nothing to build, but every
  difference shows every time, intended or not, and nothing records what moved.
- **Only the current model.** Simplest, and what the existing-environments work built for. But it
  asks a team that keeps a project per environment to merge them first, and some won't.

## 8. Decisions needed

1. **Separate repositories, or environment branches in one?** Recommended: separate projects, as
   asked. The record works for either, so this can be revisited.
2. **Where a promotion lands:** always a new branch in the target, with a pull request when the
   provider allows? Recommended: yes, never straight onto `main`.
3. **Who may promote:** an editor of the target project (who may already push there), with merging
   and deploying gated as today? Recommended: yes.
4. **Where the map, known differences and record live:** in the target project under
   `promotions/<source>.*`, committed? Recommended: yes, so they are reviewed and travel with the
   tree.
5. **Values:** never moved unless ticked? Recommended: yes.
6. **Agents:** may compare and prepare a promotion branch, but not merge or deploy it? Recommended:
   yes.
7. **Promoting more than one step** (dev → QA → production): each pair has its own record, so a
   change goes dev → QA, then QA → production. Recommended: yes, no skipping a step by default.

## 9. Phases

| Phase | Where | What |
|---|---|---|
| R1 | DirXMLDev | the pair's map and known differences over two trees; `PromotionRecord` (per-object fingerprints, the buckets); `tree.compare <target> --with <source>` and `promote.plan` / `promote.apply` operations; tests over pairs of synthetic trees with renamed drivers, mapped servers and values that differ |
| R2 | DirXMLDevWeb | *Compare with project…* (the buckets, by driver); the promotion review (ticks, line merge, both-changed side by side); the branch, commit with trailer, pull request; audit |
| R3 | both | *Pair with…* (proposed map, known differences, the first record); cases promoted with their driver; MCP `compare_projects` and `promote_changes`; docs and a tutorial section |

Each phase is usable alone: R1 from the CLI, R2 on the page for pairs already set up, R3 to
start a pair from nothing.

## 10. What this doesn't change

- **The current model:** one project for several environments, with overrides, keeps working as
  it is.
- **Deploying:** compare, plan, the typed confirmation, the production gate, snapshots and
  rollback are per project, as now.
- **Vault-to-vault comparison** (Vault → Environments) stays for environments inside one project.
