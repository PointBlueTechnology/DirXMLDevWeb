# Design note: the Connections page

Issue #131. This note covers how the Connections page should look and behave, and the one core
change it needs: trusting a vault's certificate by its fingerprint instead of accepting any
certificate. What stays the same:

- the model underneath (docs/multi-user.md): the project's definition of an environment, plus each
  person's own sign-in, in two files;
- the API's two save calls;
- the security rules (docs/security.md).

## Why

Jerry set up a production vault through this page and found it hard to follow. Writing
`docs/tutorial.md` turned up the same problems:

- **One vault takes two forms.** The project's definition (URL, driver set, tier) and the person's
  connection (bind DN, password) each have their own button and form: *New environment* and
  *An environment of my own*, then *Set up…*, *My connection* and *Definition* on each row. Nothing
  says how the two fit together.
- **The order works against the user.**
  - **Look up** (the driver sets a vault holds) needs a working sign-in, but on a new environment
    the sign-in form comes second, so Look up is disabled when it's most needed.
  - Optional fields (SSH trace host and user, "Requires", five event-store fields) sit among the
    required ones.
- **Controls are disabled without a reason.** Test connection, Save and Look up grey out with no
  explanation.
- **Certificates are all or nothing.** "Accept any certificate (a lab or a tunnel; never
  production)" is the only way to reach a vault whose certificate the server doesn't trust. A
  production vault with an internal CA leaves the user choosing between that and nothing.
- **Noise.**
  - The heading is a file path in capitals: `/VAR/LIB/IDMWEB/USERS/ME/ENVIRONMENTS.PROPERTIES (NOT THERE YET…)`.
  - The password's storage choice is a long dropdown, with "Configured: none. Leave the field empty to keep it."
  - Git tokens and driver secrets share the same scrolling page.

## Rules the layout follows

1. **Dependencies in order.** A field that needs another comes after it. Address, then certificate,
   then account and password, then **Test sign-in**, then the driver set, which is looked up with
   that sign-in.
2. **Required before optional.** Every field a vault needs comes first. Everything optional is below
   them, under **More settings**, collapsed by default and opened automatically when one of its
   fields holds a value.
3. **One status, one next action per environment.**
4. **Nothing disabled without a reason.** Where a control must stay disabled, a line under it says
   what's missing ("Test your sign-in first"). Better still, the control stays enabled and says so
   when used.
5. **Plain words.** No file paths, property names or CLI flags in the page's own text. They may
   appear in a tooltip, or in a details line for those who look.

## The page

### The list

| Column | Shows |
|---|---|
| Environment | Name, and the kind as a tag: **production** (red), **test** or **dev** |
| Vault and driver set | Host:port, the driver set's name; a second line for problems ("2 servers, 1 unreachable"; "accepts any certificate") |
| Your sign-in | **connected**, **not signed in**, or **sign-in failed** (with the reason on hover) |
| Action | One button: **Edit** (connected), **Sign in** (not signed in), **Fix** (failed) |

Above the list:
- a one-line explanation: "Vaults this project deploys to, and how you sign in to each";
- **Add a vault**, for deployers. Everyone else sees "A deployer adds the project's vaults; you then
  sign in to each."

The file path moves to a details line inside **Edit**. **An environment of my own** becomes a choice
inside **Add a vault**: "Only for me (kept in your own file)", available to everyone.

### Add a vault

One form, in this order. Only the fields in **bold** are required.

1. **Vault address**: `ldaps://host:636`.
   - On leaving the field, the server connects and reads the certificate.
   - If the server already trusts it: a green line, "Certificate trusted (issued by …)".
   - If not: the subject, issuer, expiry and SHA-256 fingerprint, with **Trust this certificate**.
     Trusting pins that fingerprint for this vault (see *Certificates*).
2. **Account DN** and **Password**.
   - The password is "Stored for you only, never shown again."
   - The link "Use a secret manager instead" swaps the password field for the secret-manager picker,
     or for an environment variable or a command, for deployers.
   - The macOS Keychain stays the default where it applies (the local workstation install).
3. **Test sign-in**: "Signed in as …", or the reason it failed, in plain words (wrong password, no
   such account, address unreachable, certificate not trusted).
4. **Driver set**: after a passing test, the vault's driver sets as a list to choose from, each with
   its driver and server counts. The first one is preselected when there's only one, and "Type a DN"
   stays available. Before a passing test, this step shows "Test your sign-in first".
5. **Name** (`PROD`) and **Kind** (production, test, dev).
6. **More settings** (optional, collapsed):
   - **Server addresses**: for a driver set with several servers, each server's own LDAPS address
     (#134). It lists the servers from the vault, with the address worked out from each server
     object, and a reachability check for each. A server that can't be reached is shown here and
     on the list.
   - **Deploy order**: "Deploy to … first". Today this is *Requires*, the production gate's earlier
     environment.
   - **Trace over SSH**: host and user.
   - **Event store**: JDBC URL, reader account, table, tree name, pseudonymise, and the reader's
     password, which is each person's own.
7. **Save vault**.

One save writes both halves, as today, through the two calls:
- the definition (address, pin, driver set, name, kind, optional settings) to the project's file;
- the deployer's own sign-in to their file.

"Only for me" writes everything to the person's own file.

### Sign in (a vault someone else defined)

This shows the vault's summary (address, driver set, kind), read-only, then steps 2 and 3 above:
**Account DN**, **Password**, **Test sign-in**, **Save**. The certificate decision is the
definition's, so nobody is asked about it here. A vault with no pin, and a certificate the server
doesn't trust, shows "Ask a deployer to trust this vault's certificate".

### Edit (one environment)

Edit shows the environment's sections stacked, in this order:

1. **Your sign-in**: account, password, test, plus **Forget my sign-in**.
2. **Vault** (deployers): address, certificate (pinned fingerprint, **Trust the new certificate**
   when it changed), driver set, kind.
3. **Servers** (deployers, multi-server sets): as in *More settings*.
4. **Driver secrets** (deployers): today's secrets panel, unchanged in content. "Configured" becomes
   **set** or **missing**, and the missing ones come first.
5. **More settings** (deployers): deploy order, trace over SSH, event store.
6. **Remove this vault** (deployers), at the bottom. It needs the name typed to confirm, as a
   deploy does.

**Git tokens** leave this page. They belong to repositories, not vaults, so they move to the project
picker's repository settings, with the page linking there.

## Rotated passwords

Passwords in these vaults are rotated: the people's own, the event-store reader's, and the drivers'
secrets (a Remote Loader's, a shim's). Every rotation breaks something until the stored password is
updated. So the page has to make it obvious *that* a password needs updating, and easy to do.

**Making it obvious**

- **A rejected password is its own state, not "not connected".**
  - A bind refused for bad credentials (LDAP result 49, including eDirectory's
    expired-password and account-disabled reasons) is shown as **password rejected**, in red.
  - It's never mixed up with **vault unreachable** (network, DNS, certificate), which has a
    different fix.
  - Its row's one action is **Update password**.
- **The page checks sign-ins when it opens.** Each environment's status comes from a bind test the
  server runs when the Connections page loads, and again in the background every few minutes while
  it's open, with "checked 2 min ago" on hover. A stale "connected" never stays on screen.
- **Seen from anywhere.**
  - When any vault call from any view (Compare, Deploy, the trace, Operations) fails because the
    password was rejected, the error says so in those words and links straight to **Update password
    for PROD**.
  - The top bar shows a small red **PROD: password rejected** until it's fixed, for the person whose
    sign-in it is.
- **Warn before it expires.** After a successful bind, the server reads the account's
  `passwordExpirationTime` and `loginGraceRemaining`, which eDirectory keeps on the account, when
  the vault's access rules let the account read them on itself.
  - **expires in N days**, shown at 14 days or fewer, in amber.
  - **N grace logins left**, once the password has expired and eDirectory is counting grace logins.
    This is urgent: every vault call uses one, so the row's action becomes **Update password now**.
  - Where the vault doesn't expose these attributes, nothing is shown and no guess is made.

**Making it easy**

- **Update password** opens the environment's **Your sign-in** with the password field focused and
  the account filled in. There's one field, **Test and save**, and **Cancel**.
- **The test comes first:** the new password replaces the stored one only after a bind with it
  succeeds. A typo can't lock you out, and the old one stays until the new one works. **Save without
  testing** is available under the button for a vault that can't be reached right now.
- **When the password comes from a secret manager, a variable or a command,** rotation happens there.
  The rejected state names the source ("The password read from AWS Secrets Manager was rejected").
  Its action is **Check again** (re-read and test) rather than a password field, with "or store a
  password here instead" as a link.
- **Driver secrets** (Edit → Driver secrets) follow the same pattern:
  - each secret's row has **Replace**, with Check (read it back) next to it;
  - after a replacement, the deploy form preselects "re-set every provided secret (a rotated
    password)" for that environment's next deploy. A rotated Remote Loader or shim password only
    reaches the vault through a deploy, and a deploy leaves secrets alone by default.
- **The event store's reader password** gets the same **password rejected** state and **Update
  password** action, on its own line under the environment.

## Certificates

**Decision (Jerry, 2026-10-16):** trust a vault's certificate by pinning its fingerprint. The page
no longer offers accept-any.

**Model.** The definition gains `<env>.certSha256=<hex>`, the SHA-256 of the vault's leaf
certificate (`<env>.servers` addresses use the same pin unless they give their own). A person's own
environments keep it in their file. A connection is accepted when the JVM trusts the chain, as
today, or when the leaf's SHA-256 equals the pin. Nothing else is accepted.

**A changed certificate** (renewed or replaced) is refused. The refusal names both fingerprints, and
the page offers **Trust the new certificate** to a deployer. A pin is never changed without someone
choosing to change it.

**Existing `trustAll`.** The setting is still read, so nothing breaks on upgrade, including installs
like PROD's. The page shows such an environment as "accepts any certificate". Its Edit offers to pin
the certificate the vault presents right now, which removes `trustAll` at the same time. The CLI
keeps `trustAll` for tunnels and throwaway labs and documents pinning first.

**Core** (DirXMLDev):
- A `PinnedTrust` trust manager: the JVM's default trust first, then a fingerprint match. It's used
  in three places:
  1. the JNDI socket factory. It's loaded by class name, so the pin reaches it per connection through
     a thread-local set around `Vault.connect`, or through a factory class per pin;
  2. the JLDAP path (`IdmOps`, `ctx.init`);
  3. `LdapTrace`'s `CertificateTrust` prompt.
- `Environments` reads `certSha256`.
- A certificate probe (`Vault.probeCertificate(url)`) returns subject, issuer, validity, SHA-256, and
  whether the JVM trusts it, without binding. The page's address step and *Trust the new
  certificate* use it.

**Web.**
- `POST /api/connections/certificate {url}` returns the probe.
- Saving a definition accepts `certSha256`, and must say where it came from: the probe the page
  just showed, never a value typed in.
- The trace's `CertificateTrust` prompt accepts the environment's pin.

## Words

| Today | On the page |
|---|---|
| New environment / An environment of my own | Add a vault (with "Only for me" inside) |
| Set up… / My connection / Definition | Sign in / Edit |
| Bind DN | Account DN |
| Test connection | Test sign-in |
| Driver set DN + Look up | Driver set (a list after the test; "Type a DN" as the fallback) |
| Requires (deployed first) | Deploy order: deploy to … first |
| SSH host (for trace) / SSH user | Trace over SSH: host, user |
| accept any certificate (a lab or a tunnel; never production) | Trust this certificate (fingerprint shown) |
| prd / stg / dev | production / test / dev (the files keep prd/stg/dev) |
| keep it in the environments file (readable by you only) | Stored for you only |
| Configured: none. Leave the field empty to keep it. | (new) nothing; (existing) "Password set. Type a new one to replace it." |
| not connected | not signed in / sign-in failed |

## Not changing

- The two files, their keys, and who may write what (docs/multi-user.md, docs/security.md). The page
  still refuses a reference-type password (variable, command, secret manager, Keychain) for anyone
  who isn't a deployer on a hosted server.
- The workstation (one file) mode's page shows the same layout, without the "Your sign-in" split.
- Driver secrets' storage and the secret-manager picker.

## Build order

1. **Core:** certificate pinning and the probe, plus the sign-in check's details: rejected
   credentials told apart from unreachable, and the account's `passwordExpirationTime` and
   `loginGraceRemaining` read after a bind (`certSha256`, `PinnedTrust` in the three trust paths,
   `trustAll` still honoured), with tests: pinned accepted, changed refused, JVM-trusted unaffected.
2. **Web, the page:**
   - the list (with the sign-in check on load and in the background), Add a vault, Sign in, and the
     Edit sections;
   - Update password with test-then-save, and the password-rejected state in the top bar and in
     vault errors;
   - the wording and the tier labels.

   It uses the probe and the existing save calls.
3. **Web, servers:** the server addresses in More settings and Edit (#134's web half), with the
   reachability check.
4. **Git tokens** move to the repository settings.

Each step is its own PR, released when it lands.

## Acceptance

- A new user adds a production vault with an internal-CA certificate:
  - they see the fingerprint, choose **Trust this certificate**, test the sign-in and pick the
    driver set from a list;
  - they never type a DN they had to look up elsewhere, and never see "accept any".
- A second person signs in to that vault without being asked about its certificate.
- A renewed certificate is refused with both fingerprints, until a deployer trusts the new one.
- After a vault password is rotated, the person's next page load shows **PROD: password rejected**,
  not "connected" or "unreachable":
  - the row and the top bar both lead to **Update password**;
  - a new password is tested before it replaces the old one;
  - a mistyped new password leaves the old one in place.
- An account within 14 days of its password expiring shows **expires in N days**; one on grace
  logins shows **N grace logins left**.
- Every control that can't be used yet says why, on the page.
- Required fields come before optional ones in every form. Sign-in comes before the driver set.
