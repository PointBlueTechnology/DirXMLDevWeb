# Security model

- The server binds to loopback only.
- The URL carries a one-time session token in its fragment. The page moves it to session
  storage and sends it as a header; every API request without it is refused.
- Requests naming another host (DNS rebinding) or coming from another origin are refused.
- Files are served only from inside the tree; `.git` and deploy snapshots are not content.
- A write quotes the tree revision it was planned against and is refused if the tree moved.
- Vault access uses the environments file and credential sources of the `idm` CLI
  (`IDM_ENVIRONMENTS`, `./environments.properties`, `~/.idm/environments.properties`). The page
  is told an environment's name and tier, never a URL, bind DN or secret.
- A password or driver secret typed into the Connections view crosses the loopback connection
  once and is stored where you chose: the macOS Keychain (`<env>.passwordKeychain`,
  `<key>Keychain`) or the owner-only environments / secrets file as a literal; or the page
  records a command, environment variable or secret-manager reference to read it from. Reads
  describe each credential by the kind of its source only; no response, log or diff carries a
  value.
- In hosted mode, acting on the server's host is the deployer's: attaching a path (a checkout in
  place, a repository, a directory) is deployer-only and confined to `setup.roots`; a command
  typed to test a secret manager runs only for a deployer (an editor may still resolve a saved
  credential by its key). A clone's token is kept in an owner-only file under the data
  directory, never in the configuration. A checkout used in place belongs to the person who
  opened it.
- Nothing is read from a vault until you choose an environment and ask. Every write to a vault
  (deploy, driver start, stop, restart) needs that environment's name typed into the page; the
  server checks it, and `IDM_AGENT_ALLOW_WRITE` does not stand in for it here.
