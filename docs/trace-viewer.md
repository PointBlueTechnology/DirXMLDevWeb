# Trace viewer in the workbench: design note

Status: **decided 2026-10-07** (Jerry took the proposals in section 7). Nothing is built yet; T1 is first, in the viewer repository.

The question: provide a web version of the
[DirXML Trace Viewer](https://github.com/PointBlueTechnology/DirXMLTraceViewer) (desktop, Swing,
MIT, 1.4.0) as part of this stack. The answer: yes, by sharing its engine rather than porting its
window. The viewer's `model` package — the DSTrace parser, formatter, highlighter, filter,
compactor, file reader — has no UI dependency and is already covered by tests; its `ldap` package
is the event-monitoring source over jldap. Those become a small library both products use. The
workbench's present Trace tab (raw lines over SSE with a text filter) is replaced by a viewer
built on the library, with the desktop viewer's features: per-driver and per-channel filtering,
syntax colouring with the engine's own DSTrace colours, find, compact whitespace, timestamp
formats, pause, record, save, and opening trace files. The desktop viewer stays; it keeps its
window, its DMG and its `driver.trace view` hand-off, and both render the same trace the same way.

## 1. What exists today

| Where | What |
|---|---|
| Desktop viewer | `model/`: `TraceParser` (headers, continuations attributed to the last header per server, DSTrace `%` directives), `DsTraceFormatter` + `FormattedText` (the `%+C`/`%nC`/`%-C` colour spans), `TraceRecord` (server, time, driver, channel, text, colour spans, header positions), `TraceHighlighter` (runs: XML markup, status keywords, DSTrace colours, header), `TraceFilter` (channels, driver names or DNs, text), `TraceCompactor`, `TimestampFormat`, `TraceFileReader`/`Writer`. `ldap/`: `LdapTraceEventSource` (DirXML + DirXML Drivers debug categories through `EdirEventSource`), `IdmExtendedOperations` (start/stop/restart), `DriverStatus`, `ServerInfo`, certificate pinning, legacy TLS. `ui/`: Swing. Tests on the model, the extended operations, the LDAP session, certificate trust. |
| DirXMLDev core | `operate/LdapTrace` over the simulator's `EdirTraceStream`: one driver's lines, continuation lines attributed to the last driver line, `driver.trace tail`, and `driver.trace view` which launches the desktop viewer. |
| DirXMLDevWeb | `GET /api/vault/trace?env&driver&server&engine` — server-sent events, one raw line each, keep-alive comments, deployer-only. `VaultView`'s Trace tab: driver and server pickers, start/stop, a text filter, a follow toggle, a `<pre>` holding the last lines. The Drivers tab shows each driver's state and trace level per server and starts/stops drivers. |

The web tab has none of the viewer's parsing: no channel attribution, no colours, no find, no
files. Doing those on raw lines would re-implement the viewer; sharing the model does not.

## 2. The library

The viewer repository gains a second Maven module, `dirxml-trace-core` (groupId `com.pointbluetech`,
MIT, Java 21): the `model` package as is, and the `ldap` package minus the Swing dialogs
(`CertificateTrust` keeps its pinning store; the prompts move behind an interface the desktop
implements with dialogs and the web answers from its per-environment settings). Its only
dependency is jldap 4.3 from Maven Central. The desktop app module depends on it and keeps
`ui/`, `update/`, `Main`. Releases attach both jars; the web's CI fetches `dirxml-trace-core` by
version the way it fetches the core jar, and the hosted image gathers it with the others.

Why a module and not a copy: one parser, one palette, one set of tests. A DSTrace quirk fixed for
the desktop is fixed for the web in the next release, and the two never disagree about what a
line means.

jldap is open source and on Maven Central; it is not one of the engine jars the build refuses in
an image. The workbench already carries no LDAP client of its own (the core's is the engine
install's `ldap.jar` at system scope), so the web server adds jldap as an ordinary dependency for
this source only.

## 3. Server side (DirXMLDevWeb)

- **Live trace.** `/api/vault/trace` keeps its URL and its SSE shape, but each event becomes a
  parsed record, not a line: `{server, receivedAt, driver, channel, header:{ts,name,tag}, text,
  runs:[[start,end,token,dsColor]…]}` — `TraceRecord` plus `TraceHighlighter.highlight`, serialised
  once on the server. The source is `LdapTraceEventSource` per server of the driver set (the
  environment's LDAPS settings, its CA or `trustAll` answering the certificate interface), one
  parser per stream. `driver` is optional: without it the stream carries every driver of the set
  and the page filters, which is how the desktop works and what a multi-driver investigation
  needs. The core's `LdapTrace` stays for the CLI and the agent (`driver.trace tail`).
- **Recording.** `record=true` on the stream also writes the formatted text through
  `TraceFileWriter` to `<data.dir>/users/<subject>/traces/<project>/<env>/<driver or all>-<timestamp>.trace` (the person's own; `~/.idm/traces/<tree>/` locally), unfiltered
  (the desktop records what passes the filter; the page can save the displayed text itself, so
  the server keeps everything). `GET /api/traces` lists them, `GET /api/traces/<name>` serves one,
  `DELETE` removes one; recordings are per project like audit lines.
- **Trace files.** `POST /api/traces/upload` (multipart, streamed to the traces directory, size
  limit configurable, default 1 GB) and `GET /api/traces/<name>/records?from&count&channels&driver&text`
  — the file is parsed once with `TraceFileReader`/`TraceParser.parseText` into an index (record
  offsets, driver, channel, a lower-cased text hash for search) kept beside the file, so a 650 MB
  file is paged and filtered on the server and the page never holds it whole. `GET
  …/find?text&after` returns the next match positions.
- **Who may use it.** Viewing trace, live or from a file, is for any signed-in user (today the
  stream is deployer-only, which was a stand-in). Start, stop and restart stay deployer-only, on
  the Drivers tab, through the core's operations as now; the viewer's `IdmExtendedOperations`
  are not used because the core already has these. **Setting a trace level is missing from the
  stack** (the Drivers tab only shows it): T2 adds `driver.trace-level` to the core — per server,
  `DirXML-TraceLevel` on a driver, `DirXML-DriverTraceLevel` on the set, the typed environment
  name like every vault write — and the Drivers tab gets the control beside start/stop.
- **Audit.** A trace session and an upload are audit lines, as the stream already is.

## 4. The page

A `TraceViewer` component used in two places: the Vault view's Trace tab (live, per
environment) and a **Trace** entry in the sidebar for files (no environment, so it works in the
workstation install and for a customer's file sent by mail).

- **Rendering.** A virtualised list (the page keeps up to the buffer size, 50,000 records,
  shows 15,000, both settable as on the desktop); each record is a block of `<span>`s from its
  runs, with CSS classes per `TraceHighlighter.Token` and per DSTrace colour index — the desktop's
  `TracePalette` becomes CSS variables, light and dark. Monospace, wrap toggle, font size,
  auto-scroll.
- **Filters** (hide): channels (Subscriber, Publisher, Service, Engine/Other), drivers (the
  driver set's list from the outline, multi-select; the driver's trace name, not its object name,
  as the parser sees it), contains text. `TraceFilter` logic runs on the page for live trace
  (records already carry driver and channel) and on the server for files.
- **Find** (highlight, do not hide): every match marked, Enter and Shift-Enter step, count shown.
- **Compact whitespace**, **timestamp format** (U.S., European, ISO 8601, time only — rewritten
  from `receivedAt` for viewer-stamped records as `withTimestampFormat` does), **pause** (the
  stream keeps collecting into the buffer; the view freezes), **record** (server-side, section 3),
  **save displayed** (download of the text on screen, filters applied), **copy** (plain text, as
  the desktop's `TraceCopy`).
- **Links into the tree.** This is what the web adds over the desktop: a policy name in a trace
  header (`Applying policy %+C%14CNOVLADDCFG-sub-ctp-…%-C`) opens that policy; a driver name
  opens the driver; a `<status level="error">` block links to the Validation panel's module.
  Resolution is by the names in the outline, on the page.
- **Keyboard**: the desktop's shortcuts where the browser allows them (find, pause, wrap, font).

## 5. What stays with the desktop viewer

Its window, the DMG and zip releases, its own connection dialog and certificate prompts, the
update notice, `--demo`, and the `driver.trace view` hand-off. The desktop is for someone who
has no workbench; the web is for someone who has the tree open and wants the policy under the
cursor.

## 6. Phases

| Step | Where | What |
|---|---|---|
| T1 | viewer repo | split into `dirxml-trace-core` + app modules; the certificate prompt behind an interface; release 1.5.0 with both jars |
| T2 | DirXMLDev + DirXMLDevWeb | `driver.trace-level` in the core; `/api/vault/trace` emits parsed records from `LdapTraceEventSource`; `TraceViewer` live: colours, filters, find, compact, timestamps, pause, save, copy; the Vault Trace tab uses it; trace viewing for any signed-in user |
| T3 | DirXMLDevWeb | recordings and files: `/api/traces/*`, upload, server-side index and paging, the sidebar Trace entry |
| T4 | DirXMLDevWeb | links into the tree (policy, driver, status → validation); buffer settings |

T1 is Jerry's repository; T2 starts when 1.5.0 exists.

## 7. Decisions (taken 2026-10-07)

1. **A `dirxml-trace-core` module in the viewer repository**, released beside the app; the web
   depends on it by version. No copy of the model.
2. **Trace viewing for any signed-in user**; start, stop, restart and trace level stay
   deployer-only.
3. **Recordings and uploads per project under the data directory**, 1 GB limit by default.
4. **The live stream carries the whole driver set** and the page filters; one event registration
   per server.
