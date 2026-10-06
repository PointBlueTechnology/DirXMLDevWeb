# Keycloak for DirXMLDevWeb

`realm-example.json` is a realm with two groups (`idm-editors`, `idm-deployers`), two test users
(`alice` in the editors, `bob` in the deployers — passwords in the file, for a lab only), and the
`idmweb` client (redirect URI `http://localhost:8081/*`, the port in the `docker run` below and in `public.url`): confidential, authorization-code flow with PKCE, a **group membership mapper**
that puts the user's groups into the ID token's `groups` claim (which `oidc.groupsClaim=groups`
reads; without full paths). Run it for development with

```bash
docker run -d --name idmweb-keycloak -p 127.0.0.1:8081:8080 \
  -v "$PWD/hosted/keycloak/realm-example.json:/opt/keycloak/data/import/realm.json:ro" \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=change-me \
  quay.io/keycloak/keycloak:26.0 start-dev --import-realm
```

and point `hosted.properties` at it. The realm's redirect URI must be `<public.url>/auth/callback`:
the example allows `http://localhost:8081/*`, so either run the server with
`public.url=http://localhost:8081` (and Keycloak on another port) or edit the redirect URI in the
JSON before importing (`bin/smoke-oidc.sh` does that with `sed`):

```properties
identity=oidc
oidc.issuer=http://localhost:8081/realms/idm
oidc.clientId=idmweb
oidc.clientSecretKeychain=idmweb/oidc        # or oidc.clientSecret for a lab
oidc.groupsClaim=groups
roles.editor=idm-editors,idm-deployers
roles.deployer=idm-deployers
```

For a real realm: create the client the same way (confidential, PKCE S256, redirect URI
`<public.url>/auth/callback`), add the group mapper (or use `oidc.groupsClaim=realm_access.roles`
for realm roles), and map your directory's groups. Entra ID: `groups` claim with group ids, or
`roles` with app roles. OSP: the claim its client is configured to emit.
