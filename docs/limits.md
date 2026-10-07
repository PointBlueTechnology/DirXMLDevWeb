# Known limits

- The structured policy editor covers DirXML Script. XSLT and ECMAScript are edited as source.
- The editor's grammar table (`web/src/policy/grammar.json`) is generated from the DirXML Script
  DTD that ships with Designer by `tools/dtd2grammar.py`; regenerate it for a newer DTD.
- The PRD and form editors cover the common settings; an activity's REST, role-request,
  resource-request and notification settings, a form field's other properties and owners,
  approvers and other languages of a role go through Operations (`flow.activity.set`,
  `form.field.set --prop`, `role.set`). Branches are inserted with `flow.branch.add` there.
- `package.import` (a jar from disk) is CLI-only — Update sites covers repositories.
- Deploy from the page covers the common case. Secrets, deleting a driver, drift capture,
  stepwise deploys and rollback stay with `idm vault.deploy` and `idm vault.rollback`; a deploy's
  result names its snapshot.
- The trace view reads over the environment's LDAPS connection and keeps the last 5,000 lines.
- The simulator view creates plain cases (a driver, a channel, an input document). A case's
  other keys (schema, a fake directory, assertions, a live query source) are honoured when run
  but are edited in its files; comparing with another tree stays with `idm simulate --against`.
- Cases are kept in `cases/` beside the tree (or `--cases DIR`). They are not part of the
  tree's revision: the page reloads them after its own writes.
- Hosted sessions live in memory: a restart signs everyone out. Pull requests are a link to the
  provider's compare page; creating them through an API is a follow-up.
