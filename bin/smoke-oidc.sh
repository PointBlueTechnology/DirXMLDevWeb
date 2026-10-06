#!/bin/sh
# Hosted mode against a real OpenID Connect provider: bin/smoke-oidc.sh
# Needs Docker: starts Keycloak with hosted/keycloak/realm-example.json, runs the server with
# identity=oidc, and signs in headlessly through Keycloak's login form (authorization code + PKCE),
# then checks the session, roles from the groups claim, and the audit line. Skips without Docker.
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
IDM_HOME=${IDM_HOME:-"$HERE/../DirXMLDev"}
if ! docker info >/dev/null 2>&1; then
  echo "smoke-oidc: skipped (no Docker)"
  exit 0
fi
WORK=$(mktemp -d)
KC=idmweb-keycloak-smoke
trap 'kill $PID 2>/dev/null || true; docker rm -f $KC >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
"$IDM_HOME/bin/idm" import-ldif "$IDM_HOME/src/test/resources/fixtures/synthetic/driverset.ldif" "$WORK/seed/tree" >/dev/null
git -C "$WORK/seed" init -q -b main && git -C "$WORK/seed" -c user.name=s -c user.email=s@x add -A && git -C "$WORK/seed" -c user.name=s -c user.email=s@x commit -q -m seed
git init -q --bare -b main "$WORK/repo.git" && git -C "$WORK/seed" push -q "$WORK/repo.git" main
KCPORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
docker rm -f $KC >/dev/null 2>&1 || true
# the example realm's redirect URI names port 8081; this run's port goes in instead
sed "s#http://localhost:8081#http://127.0.0.1:$PORT#g" "$HERE/hosted/keycloak/realm-example.json" > "$WORK/realm.json"
docker run -d --name $KC -p 127.0.0.1:$KCPORT:8080 -v "$WORK/realm.json:/opt/keycloak/data/import/realm.json:ro" \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin-test-pw quay.io/keycloak/keycloak:26.0 start-dev --import-realm >/dev/null
i=0
until curl -sf "http://127.0.0.1:$KCPORT/realms/idm/.well-known/openid-configuration" >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -gt 90 ] && { echo "keycloak did not start"; docker logs $KC | tail -20; exit 1; }; sleep 2
done
mkdir -p "$WORK/data"
cat > "$WORK/hosted.properties" <<ENV
public.url=http://127.0.0.1:$PORT
bind=127.0.0.1
port=$PORT
data.dir=$WORK/data
repo.url=$WORK/repo.git
repo.tree=tree
environments.file=$WORK/data/environments.properties
identity=oidc
oidc.issuer=http://127.0.0.1:$KCPORT/realms/idm
oidc.clientId=idmweb
oidc.clientSecret=idmweb-test-secret
oidc.groupsClaim=groups
roles.editor=idm-editors,idm-deployers
roles.deployer=idm-deployers
ENV
IDM_ENVIRONMENTS="$WORK/data/environments.properties" "$HERE/bin/idmweb" serve --hosted "$WORK/hosted.properties" > "$WORK/log" 2>&1 &
PID=$!
i=0
while ! grep -q 'hosted:' "$WORK/log" 2>/dev/null; do i=$((i + 1)); [ $i -gt 60 ] && { cat "$WORK/log"; exit 1; }; sleep 0.25; done
python3 - "http://127.0.0.1:$PORT" "$WORK" <<'PY'
import html, json, os, re, sys, urllib.request, urllib.parse
from http.cookiejar import CookieJar, DefaultCookiePolicy
base, work = sys.argv[1], sys.argv[2]

def check(what, ok):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        sys.exit(1)

class Stop(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None

def sign_in(user, password):
    # Keycloak marks its cookies Secure; a browser sends them to 127.0.0.1 over http (a secure context), so does this client
    jar = CookieJar(DefaultCookiePolicy(secure_protocols=("https", "http")))
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), Stop())
    def go(url, data=None):
        try:
            with opener.open(urllib.request.Request(url, data=data)) as r:
                return r.status, r.read().decode(), dict((k.lower(), v) for k, v in r.headers.items())
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(), dict((k.lower(), v) for k, v in e.headers.items())
    s, _, h = go(base + "/auth/login?next=/")
    check("login redirects to the provider with PKCE", s == 303 and "code_challenge_method=S256" in h["location"] and "openid-connect/auth" in h["location"])
    s, page, _ = go(h["location"])
    action = html.unescape(re.search(r'action="([^"]+)"', page).group(1))
    s, _, h = go(action, urllib.parse.urlencode({"username": user, "password": password, "credentialId": ""}).encode())
    txt = re.sub(r"\s+", " ", re.sub(r"<script.*?</script>", " ", _, flags=re.S))
    m = re.search(r'kcAlertMessage[^>]*>(.*?)</span>|error-message">(.*?)<|id="input-error[^>]*>(.*?)<', _, re.S)
    check("the provider accepts the user and sends the code back", s == 302 and h["location"].startswith(base + "/auth/callback?") and "code=" in h["location"])
    s, _, h = go(h["location"])
    check("the callback verifies the ID token and sets the session cookie", s == 303 and "idmweb_session=" in h.get("set-cookie", "") and h["location"] == "/")
    cookie = h["set-cookie"].split(";")[0]
    return cookie

def api(cookie, path):
    req = urllib.request.Request(base + path, headers={"Cookie": cookie})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

alice = api(sign_in("alice", "alice-test-pw"), "/api/session")
check("Alice is an editor by the groups claim, with name and email from the token", alice["user"]["name"] == "Alice Example" and alice["user"]["email"] == "alice@example.com" and alice["user"]["editor"] and not alice["user"]["deployer"])
bob = api(sign_in("bob", "bob-test-pw"), "/api/session")
check("Bob is a deployer", bob["user"]["deployer"] and bob["user"]["subject"] != alice["user"]["subject"])
s = None
try:
    urllib.request.urlopen(base + "/auth/callback?code=x&state=nope")
except urllib.error.HTTPError as e:
    s = e.code
check("a callback with an unknown state is refused", s == 400)
with open(os.path.join(work, "data", "audit.log")) as f:
    lines = [json.loads(l) for l in f if l.strip()]
check("the audit log records both sign-ins through oidc", sum(1 for l in lines if l["event"] == "sign-in" and l["details"].get("provider") == "oidc") == 2)
print("smoke-oidc: all passed")
PY
