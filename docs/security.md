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
- On a hosted server the environments file holds the project's definitions only; a person's
  bind DN and password source go to their own `data.dir/users/<subject>/environments.properties`
  (`0600` in a `0700` directory), reached only through their session and never listed, read or
  returned for anyone else. Driver secrets stay beside the definitions, deployer-only
  (docs/multi-user.md).
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

## Older TLS suites

eDirectory's LDAPS listener often offers only static-RSA key exchange (`TLS_RSA_*`, for example
`AES256-GCM-SHA384`), no ECDHE and no TLS 1.3. Recent JDK builds disable those suites by default,
and the symptom is a connection test or vault bind that fails with "simple bind failed" although
the credentials are right. The server therefore keeps `TLS_RSA_*` enabled, first thing at
start-up, on every install. Those suites lack forward secrecy: when every vault you connect to
offers ECDHE, opt out with `IDM_TLS_LEGACY=false` in the container's environment
(`-Didm.tls.legacy=false` for the Java launchers).

An image from before this change gets the same effect from a `java.security` override: a file
with the JDK's `jdk.tls.disabledAlgorithms` list minus `TLS_RSA_*`, named in
`IDM_JAVA_OPTS=-Djava.security.properties=/etc/idmweb/legacy-tls.security` in `idmweb.env`.

