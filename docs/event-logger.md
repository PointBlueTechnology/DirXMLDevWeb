# Event Logger integration: design note

Status: **decided 2026-10-07** (Jerry took the proposals in section 6). Built: the event store in DirXMLDev 0.14.0 with DirXMLDevWeb 0.17.0, the Events view in 0.19.0.

The question: can [DIrXMLEventLogger](https://github.com/jcombs-pointblue/DIrXMLEventLogger)
be used by, and folded into, the DirXMLDev / DirXMLDevWeb / DirXMLSimulator stack?
The answer: yes, and the best fit is the one its README names — captured events as
test input. The logger becomes the stack's **event store**: the simulator takes its
cases from it, the workbench shows it with links into the tree, and the logger
itself ships as a package. The Flask UI is not ported; its pages are re-made in the
workbench where they can link to drivers, policies and cases.

## 1. What the logger is

- A driver shim (`com.pointblue.idm.eventlogger.EventLoggerDriver`) on the subscriber
  channel of its own driver. Every add, modify, delete, sync, rename and move that passes
  its filter is written to PostgreSQL: one row per event in `dxmlevent` — `eventid` (the
  engine's `event-id`, primary key), `classname`, `srcdn`, `srcentryid`, `eventtype`,
  `eventjson` (jsonb, from the `xds2json` converters), `xmlevent` (the raw XDS, when
  `storeXML=true`), `cachedtime`, `srcdriver`. Indexes on `REVERSE(srcdn)` (subtree
  queries) and `srcdriver`.
- `PolicyLogger`: a static registry keyed by the EventLogger driver's DN. Any driver's
  policy can log a document from ECMAScript — `PolicyLogger.logEvent(eventLoggerDN,
  thisDriverDN, channel, policyName, xml)` — without database credentials. That is a
  per-policy, per-channel capture of a real document at a named point in the flow.
- A Flask UI (timeline per object, modify diff, recent, full-text search, stats, CSV).
- Offline test jigs for the shim, a JSON→XML converter, a load generator.
- Retention: size-based cleanup with pg_cron (latest commit).

It already runs on edir3: the tree imported from edir3 carries the `EventLogger` driver,
pointed at a PostgreSQL on another host.

## 2. Where it plugs in

Five integration points, in the order they should be built. 1 and 2 are the phase this
note proposes; 3–5 are listed so the shape of 1 and 2 leaves room for them.

### 2.1 Simulator cases from logged events (the phase)

A simulator case is a directory: `case.properties` (driver, channel), `input.xds`, and
optionally a golden `expected-output.xds` or `expected.assertions`. A logged event's raw
XML is exactly an `input.xds`. Two sources:

- **An event row** (`xmlevent`): the document as it reached the EventLogger driver's
  subscriber channel — the vault's event after the EventLogger's own filter, before any
  other driver's policies. Replayed through driver *X*'s subscriber chain, it answers
  "what would X do with this real event?".
- **A PolicyLogger row**: the document at a named policy of a named driver and channel.
  Replayed from that stage, it is a regression input for exactly that policy set.

"Save as case" takes a row, the target driver (default: the row's `srcdriver`, or for
PolicyLogger rows the driver that logged it) and the channel, writes
`cases/<name>/{case.properties,input.xds}` beside the tree, and optionally runs it at
once and records the golden. Cases built this way carry `source=events:<eventid>` in
`case.properties` so the corpus stays traceable to the store.

Rows without `xmlevent` (`storeXML=false`) are rebuilt from `eventjson` with the
logger's `JsonToXmlConverter`; the case is marked `reconstructed=true`, because the
converters do not keep everything (operation-data order, comments, unknown elements).

### 2.2 Events in the workbench

- **Core** (DirXMLDev): an `EventStore` over JDBC, read-only, with `query events`
  (by DN or subtree, driver, type, class, time window, free text over the JSON) and
  `query event <id>`; `events.case` is the one write op, and it writes to the cases
  directory, never to the store. The PostgreSQL JDBC driver (BSD-2) is an ordinary
  dependency; nothing proprietary.
- **Environment settings** (the environments file, same shape as the vault bind):
  `<env>.eventsUrl=jdbc:postgresql://host:5432/idmEvent`, `<env>.eventsUser`,
  `<env>.eventsPassword=` (or `…PasswordEnv=` / `…PasswordCommand=`, or `…PasswordKeychain=`
  on a macOS workstation, like the other secrets; on a hosted server the reader password is in each
  person's own file, and a reference is a deployer's), `<env>.eventsTable` (default `public.dxmlevent`). The read-only
  `eventlogger_reader` account the logger's README already asks for is the one to use.
- **Web**: `/api/events/*` on `VaultService`'s model (per environment, no credentials
  on the page), an **Events** view with the Flask pages re-made — object timeline with
  the modify diff, recent, search, stats — plus what Flask cannot do: the source driver
  opens the driver, a PolicyLogger row's policy name opens that policy, an event has
  *Save as case* and *Run through driver…* (the simulator view with the case
  pre-filled). The agent (MCP) gets the same queries.

### 2.3 The logger as a package

Build the EventLogger driver into a package in the catalog (the existing
`package.build` from the driver in the tree), so any lab gets it with the New Driver
flow. Two things our deploy cannot do and the docs must say: the shim jar and the JDBC
jar go on the engine host's classpath (`/opt/novell/eDirectory/lib/dirxml/classes/`,
restart), and the database must exist with the DDL applied. The containerised logger
(the other session's goal) should ship a compose that mounts the two jars into the
engine container and brings up PostgreSQL with the DDL and the reader account — then
the lab's "install" is one `docker compose up`.

### 2.4 A Library resource for PolicyLogger

An ECMAScript resource (`pbt-eventlog.js`, wrapping `PolicyLogger.logEvent` with the
EventLogger DN from a driver-set GCV) and a one-rule template policy "log the document
here". Linked into any policy set from the flow's set panel, it makes "capture samples
at this stage" one reviewed change. Needs 2.1 so the captured rows turn into cases.

### 2.5 Liveness on the cards (later)

Event counts per driver for the last day from the store on the home cards and the
driver-set view. Cheap once 2.2 exists; not part of the phase.

## 3. Changes the logger repository needs first

These are in the hand-off prompt for the session working on the logger; the stack's
side depends on the first two.

1. **Redact passwords.** `BaseEventConverter.processPassword` copies the `<password>`
   text into the JSON, and `xmlevent` keeps the raw document. Both must be masked before
   the store is read by a workbench or an agent. Also `<modify-password>`,
   `nspmDistributionPassword`-style attributes, and operation-data passwords.
2. **A build and a release.** A `pom.xml` (the engine jars `provided`, as DirXMLDev does
   it), tests for the converters (round trip through `JsonToXmlConverter`), a GitHub
   release with the shim jar attached — so CI here can fetch it like the core jar, and
   the package in 2.3 can name a version.
3. **PolicyLogger rows need their own columns.** Today channel and policy name travel
   inside the JSON (or not at all); the store needs `channel` and `policy` columns (and
   `stage`: `input`/`output`) so 2.1 can find "the document at policy P of driver D".
   Migration: `ALTER TABLE … ADD COLUMN`, nullable.
4. **Keep `storeXML=true` as the recommendation** for development stores; the raw
   document is what the simulator wants.
5. Stable JSON shape: a `schemaVersion` in the JSON (or a column) so readers can tell
   old rows from new.

## 4. What is *not* proposed

- Porting the Flask UI as is. Its pages come back inside the workbench (2.2) where they
  can link into the tree; the Flask app stays usable for teams without the workbench.
- Writing to the store from the stack. Only the engine (through the logger) writes
  events; the stack reads, and writes cases to the tree.
- Replacing the trace stream. The engine trace (`vault.trace`) stays the live view; the
  store is the persistent, queryable one.

## 5. Phase plan

| Step | Where | What |
|---|---|---|
| L1 | logger repo | password redaction, pom + tests + release, `channel`/`policy`/`stage` columns |
| C1 | DirXMLDev | `EventStore`, `query events`, `query event`, `events.case`; env keys; docs |
| W1 | DirXMLDevWeb | `/api/events/*`, Events view (timeline, diff, recent, search, stats), *Save as case*, *Run through driver*, links to driver/policy |
| P1 | catalog / docs | EventLogger package; install notes (jars on the engine classpath, DDL, reader account); compose from the logger repo |
| R1 | Library | `pbt-eventlog.js` + template policy, "log here" in the set panel |

C1 and W1 follow L1's first two items; P1 follows the containerised logger; R1 last.

## 6. Decisions (taken 2026-10-07)

1. **Store per environment.** `<env>.events*` keys beside the vault bind; dev and production
   stores differ and the credentials are already per environment.
2. **Captured cases go in the tree's `cases/` directory**, committed with the tree, so a
   production sample becomes a regression test in the repository. A case that must not be
   committed is saved outside the tree by choice, not by default.
3. **Any signed-in user may read the store** through the read-only reader account; when a
   store holds production names, the DN search and the saved cases go through the same
   `pseudonymise` option the vault clone has.
4. **The Flask UI stays in the logger repository** as the standalone viewer; the workbench's
   Events view does not replace it for teams without the workbench.
