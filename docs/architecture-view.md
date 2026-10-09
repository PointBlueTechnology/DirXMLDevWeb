# Architecture and Developer views: design note

Status: **decided 2026-10-09** (section 6) for issue #32; A1 built (the Architecture view with the live overlay and export; DirXMLDev 0.18.0), A2 next. Jerry: "the visuals are
important for marketing the solution; ideally we want parity with the views in Designer."

## 1. What Designer shows, and what the page shows today

Designer has one canvas, the **Modeler**, in two modes, and an outline beside it:

| Designer | What it draws | The page today |
|---|---|---|
| Modeler, **Architect** mode | the Identity Vault as a tall panel with its driver set; one box per **application** (icon chosen by the driver's application type, the application's name); a line from vault to application with the **driver** drawn on it | Home: a grid of driver cards (name, shim class, counts) |
| Modeler, **Developer** mode | the same, with each driver line opened into its Subscriber and Publisher channels and their policy sets | Flow: one driver's fishbone at a time |
| **Outline** (Developer perspective) | the whole project as a tree: driver set, libraries, each driver's channels, policy sets, policies, resources, entitlements, jobs, forms, PRDs | the sidebar tree: drivers → driver/subscriber/publisher policies, resources, entitlements |

The page has the data for all of it: the outline, each driver's fishbone model (policy sets in
engine order, policies in linkage order), the driver's Designer **application type** (the core's
`ApplicationType`, read from Designer's own model-item definitions by shim class, else by base
package) and the driver's **icon bytes** (`Driver.icon`, the vault's `DirXML-DriverImage`, the
same file Designer shows). What is missing is the two pictures.

## 2. The Architecture view

`#type=architecture`, a nav entry under Home. One SVG canvas, drawn by the page from an
`/api/architecture` answer, pan and zoom, *Fit*.

**Layout, as Designer's Architect mode:**

- The **Identity Vault** in the centre: a tall rounded panel with the vault icon, the tree's name
  and the driver set's DN, the servers listed small at the bottom; the **driver set** as a band
  across it with its name and the counts (drivers, library items, packages).
- **Applications** in two columns, left and right of the vault, sorted by name and alternated so
  the columns balance: a card with the application's **icon** (the driver's own; the generic
  application glyph when it has none), the **application name** (the type's display name —
  *Active Directory*, *SCIM*, *JDBC* — or the driver's name when the type is unknown) and the
  driver's name beneath when it differs.
- A **connector** from the vault's edge to each application, with the **driver badge** on it: a
  small round node holding the driver's icon, as Designer draws the driver object on the line.
- **Vault-only drivers** — those with no external system: User Application, Loopback, Null,
  Entitlements Service, Role and Resource Service, Managed System Gateway, Data Collection — are
  drawn in a row **beneath the vault**, attached to its driver-set band, so the picture says what
  they are: part of the vault, not an application (decision 2).
- **Hover** on an application or badge: shim class, package, policy and entitlement counts,
  and, when an environment is chosen, the driver's state and cache size. **Click** an application
  → the driver's Flow view; **click** a badge → its Configuration; the User Application card also
  offers Roles and resources.
- **Live overlay** (decision 4): with an environment chosen in the shared picker, one
  `/api/vault/status` call colours each badge — running green, stopped grey, disabled red,
  unknown hollow — and the vault panel shows which server answered. Off by default; a *Show
  state* toggle.
- **Filter** box: a name or shim fragment dims everything else, as the sidebar's filter does.
- **Export**: *Download SVG* and *Download PNG (2×)*. The SVG is self-contained — styles inlined,
  icons embedded as data URLs, fonts named with fallbacks — so it drops into a document or a
  slide as it looks on the page. Light and dark follow the page's theme; the export takes the
  current one.

Drawn with the page's own tokens: the vault in the accent colour, cards on the surface colour
with the border token, connectors in the muted text colour, badge dots in `--ok` / `--err`. No
diagram library; the fishbone renderer shows the way (plain SVG, computed layout).

## 3. The Developer view

`#type=developer`, a nav entry beside Architecture. The whole driver set as one tree, full page,
the way Designer's outline reads in the Developer perspective (decision 3):

```
Driver Set (name, DN)
├─ Configuration: GCVs, servers, packages, linkage
├─ Library: policies, ECMAScript, mapping tables, GCV objects
└─ Drivers
   └─ Active Directory Driver   [Active Directory]  running
      ├─ Configuration: driver.xml, filter, schema map, GCVs, ECVs, shim settings, app schema
      ├─ Subscriber
      │  ├─ Event Transformation   (policies in linkage order)
      │  ├─ Matching · Creation · Placement · Command Transformation · Output Transformation
      ├─ Publisher
      │  ├─ Input Transformation · Event Transformation · Matching · Creation · Placement · Command Transformation
      ├─ Resources: ECMAScript, mapping tables, GCV objects
      ├─ Entitlements
      ├─ Jobs
      └─ Forms · Provisioning request definitions   (the User Application)
```

- Policy sets in the engine's order with the policies in **linkage order**, the same model the
  fishbone draws (`Fishbone.model` per driver, built once by the server for the whole set).
- Every node shows its count; *Expand all* / *Collapse all*; a filter box that keeps the
  matching nodes and their ancestors; a click opens what the sidebar would open (artifact,
  config editor, entitlement, form, PRD); the keyboard moves as in a tree.
- The state column at the driver level follows the same live overlay as the Architecture view.

The sidebar tree stays as it is (navigation); the Developer view is the whole set at once,
for orientation and the round-trip check the issue names.

## 4. Server

- `GET /api/architecture`: `{ driverSet: {name, dn, servers, counts}, applications: [ {driver,
  dn, shimClass, type, typeName, vaultOnly, icon (bool), counts: {policies, entitlements,
  resources, forms, prds}} ], developer: [tree nodes] }` — the outline plus, per driver, the
  application type (`ApplicationType.of(shimClass, basePackage)`), whether an icon is present,
  and the fishbone's policy sets for the Developer tree. Built per request from the tree (the
  outline already is); cached by revision like the outline.
- `GET /api/driver-icon?driver=…`: the driver's icon bytes with the right `Content-Type`
  (`gif`/`png` by the recorded extension or the magic number); 404 when none; the page draws
  its generic glyph then. Served with a long cache header keyed by revision.
- Nothing is written.

## 5. Not in this change

- Designer's Developer **mode on the canvas** (channels and policy sets drawn on the driver
  lines): the Developer tree covers the content; a canvas version can follow if the picture is
  wanted for marketing too.
- Editing from the canvas (Designer lets you drag applications about): the layout is computed.
- Printing to PDF beyond the SVG/PNG export.

## 6. Decisions (taken 2026-10-09)

1. **Two columns around the vault**, Designer's own arrangement.
2. **Vault-only drivers beneath the vault.**
3. **Developer view as a full-page tree** now; the canvas Developer mode is a possible follow-up.
4. **Live state overlay in the first release.**
5. **Export both SVG and PNG.**

## 7. Phases

| Phase | What |
|---|---|
| A1 | `/api/architecture`, `/api/driver-icon`; the Architecture view with hover, click, filter, fit, export |
| A2 | the Developer view |
| A3 | the live state overlay on both |

## 8. As built (A1)

- `GET /api/architecture`: the set (name, DN, servers, drivers, library items, installed
  packages) and one application per driver (`type`, `typeName`, `vaultOnly`, `icon`, counts).
  `GET /api/driver-icon?driver=…`: the icon bytes with their image type, 404 when none.
- `ArchitectureView`: `archLayout` places external applications in two columns alternated by
  name order and vault-only drivers beneath; cards carry the driver's icon (an initials glyph
  when it has none), the application type's name and the driver name with its shim class; the
  driver badge sits on the connector. Hover: shim, counts, state. Click a card: the Flow view;
  click a badge: Configuration. Filter dims. Zoom and Fit. *show state* (remembered) reads
  `/api/vault/status` for the chosen environment and colours the badges. *Download SVG* embeds
  the page's colour tokens and the icons as data URLs; *Download PNG* renders that at 2×.
- A driver whose type the tree does not record (a Remote Loader shim with no
  `designer.driver-type`) is labelled by its driver name with the generic glyph, as Designer's
  importer would without the base package; carrying the type from the base package stamp is a
  follow-up.
