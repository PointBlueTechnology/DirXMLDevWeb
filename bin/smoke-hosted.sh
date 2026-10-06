#!/bin/sh
# End-to-end check of hosted mode on this machine: bin/smoke-hosted.sh
# Makes a bare git repository holding the synthetic tree, starts the server with --hosted on
# loopback with the `none` identity provider, and walks sign-in, CSRF, roles, opening a branch,
# an edit, commit and push, update from main, and the audit log. Exits non-zero on the first failure.
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
IDM_HOME=${IDM_HOME:-"$HERE/../DirXMLDev"}
WORK=$(mktemp -d)
trap 'kill $PID 2>/dev/null || true; rm -rf "$WORK"' EXIT
# the team repository: a bare repo whose main holds tree/ and cases/
"$IDM_HOME/bin/idm" import-ldif "$IDM_HOME/src/test/resources/fixtures/synthetic/driverset.ldif" "$WORK/seed/tree" >/dev/null
mkdir -p "$WORK/seed/cases"
echo "# simulator cases" > "$WORK/seed/cases/README.md"
git -C "$WORK/seed" init -q -b main
git -C "$WORK/seed" -c user.name=seed -c user.email=seed@example.com add -A
git -C "$WORK/seed" -c user.name=seed -c user.email=seed@example.com commit -q -m "seed"
git init -q --bare -b main "$WORK/repo.git"
git -C "$WORK/seed" push -q "$WORK/repo.git" main
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
mkdir -p "$WORK/data"
cat > "$WORK/hosted.properties" <<ENV
public.url=http://127.0.0.1:$PORT
bind=127.0.0.1
port=$PORT
data.dir=$WORK/data
repo.url=$WORK/repo.git
repo.base=main
repo.tree=tree
repo.cases=cases
environments.file=$WORK/data/environments.properties
identity=none
none.users=alice:Alice Example:alice@example.com:idm-editors;bob:Bob Deployer:bob@example.com:idm-deployers;carol:Carol Reader:carol@example.com:
roles.editor=idm-editors,idm-deployers
roles.deployer=idm-deployers
ENV
IDM_ENVIRONMENTS="$WORK/data/environments.properties" "$HERE/bin/idmweb" serve --hosted "$WORK/hosted.properties" > "$WORK/log" 2>&1 &
PID=$!
i=0
while ! grep -q 'hosted:' "$WORK/log" 2>/dev/null; do
  i=$((i + 1))
  [ $i -gt 60 ] && { echo "server did not start:"; cat "$WORK/log"; exit 1; }
  sleep 0.25
done
python3 - "http://127.0.0.1:$PORT" "$WORK" <<'PY'
import json, os, subprocess, sys, urllib.request, urllib.error, urllib.parse
base, work = sys.argv[1], sys.argv[2]

def check(what, ok):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        sys.exit(1)

class Client:
    def __init__(self):
        self.cookie = None
        self.csrf = None
    def call(self, method, path, body=None, headers=None, raw=False, csrf=True):
        h = {"Content-Type": "application/json"}
        if self.cookie:
            h["Cookie"] = self.cookie
        if csrf and self.csrf and method != "GET":
            h["X-IDMWeb-CSRF"] = self.csrf
        h.update(headers or {})
        data = None if body is None else (body if raw else json.dumps(body).encode())
        req = urllib.request.Request(base + path, method=method, headers=h, data=data)
        opener = urllib.request.build_opener(NoRedirect())
        try:
            with opener.open(req) as r:
                text = r.read().decode()
                return r.status, (json.loads(text) if text.startswith("{") else text), {k.lower(): v for k, v in r.headers.items()}
        except urllib.error.HTTPError as e:
            text = e.read().decode()
            return e.code, (json.loads(text) if text.startswith("{") else text), {k.lower(): v for k, v in e.headers.items()}
    def sign_in(self, user):
        s, body, h = self.call("POST", "/auth/callback", body=("user=%s&next=/" % user).encode(), raw=True, headers={"Content-Type": "application/x-www-form-urlencoded"})
        check("sign-in as %s redirects with a session cookie" % user, s == 303 and "idmweb_session=" in h.get("set-cookie", "") and "HttpOnly" in h.get("set-cookie", ""))
        self.cookie = h["set-cookie"].split(";")[0]
        s, sess, _ = self.call("GET", "/api/session")
        self.csrf = sess["csrf"]
        return sess

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None

anon = Client()
s, body, _ = anon.call("GET", "/api/session")
check("without a session the API says to sign in", s == 401 and body.get("login") == "/auth/login")
s, page, _ = anon.call("GET", "/auth/login")
check("the none provider's page lists the configured users", s == 200 and "Alice Example" in page and "Bob Deployer" in page)
check("another host is refused", anon.call("GET", "/api/session", headers={"Host": "evil.example"})[0] == 403)

alice = Client()
sess = alice.sign_in("alice")
check("the session names the user and roles, and no workspace yet", sess["mode"] == "hosted" and sess["user"]["name"] == "Alice Example" and sess["user"]["editor"] and not sess["user"]["deployer"] and sess["workspace"] is None)
s, body, _ = alice.call("GET", "/api/outline")
check("the tree is 409 until a branch is open", s == 409 and body.get("noWorkspace"))
check("a write without the CSRF token is refused", alice.call("POST", "/api/workspaces/open", {"branch": "feature/x"}, csrf=False)[0] == 403)
s, ws, _ = alice.call("GET", "/api/workspaces")
check("the workspaces list names the repository, base and branches", s == 200 and ws["base"] == "main" and ws["branches"] == ["main"] and ws["repository"].endswith("repo.git"))
s, opened, _ = alice.call("POST", "/api/workspaces/open", {"branch": "feature/x"})
check("a new branch is cloned from main and opened", s == 200 and opened["branch"] == "feature/x" and os.path.isdir(os.path.join(work, "data", "workspaces", "alice", "feature_x", ".git")))
s, outline, _ = alice.call("GET", "/api/outline")
check("the workspace's tree is served", s == 200 and outline["drivers"][0]["name"] == "Loop")
s, st, _ = alice.call("GET", "/api/git/status")
check("git status: on the branch, clean, with the base and no pull-request link for a local remote", s == 200 and st["branch"] == "feature/x" and st["changed"] == [] and st["base"] == "main" and st["compareUrl"] is None)
s, sim, _ = alice.call("GET", "/api/sim/cases")
check("the corpus is the repository's cases/", s == 200 and sim["dir"].endswith("/feature_x/cases"))
rev = alice.call("GET", "/api/session")[1]["revision"]
s, op, _ = alice.call("POST", "/api/op/gcv.set", {"args": {"name": "synth.company", "value": "Hosted Corp"}, "dryRun": False, "revision": rev})
check("an edit lands in the workspace", s == 200 and op["written"])
s, st, _ = alice.call("GET", "/api/git/status")
check("git status sees the change", s == 200 and any(c["file"].endswith("config-values.xml") for c in st["changed"]))
s, c, _ = alice.call("POST", "/api/git/commit", {"message": "Rename the company", "push": True})
check("commit and push as the signed-in user", s == 200 and c["committed"] and c["pushed"])
log = subprocess.run(["git", "--git-dir", os.path.join(work, "repo.git"), "log", "feature/x", "-1", "--format=%an <%ae> %s"], capture_output=True, text=True).stdout.strip()
check("the repository has the commit on the branch, authored by her", log == "Alice Example <alice@example.com> Rename the company")
s, up, _ = alice.call("POST", "/api/git/update", {})
check("update from main merges (nothing new)", s == 200 and up["merged"])
check("a deploy needs the deployer role", alice.call("POST", "/api/vault/deploy", {"env": "x", "confirm": "x"})[0] == 403)
check("so does changing a connection", alice.call("POST", "/api/credentials/environment", {"name": "x"})[0] == 403)

bob = Client()
bob.sign_in("bob")
s, opened, _ = bob.call("POST", "/api/workspaces/open", {"branch": "feature/x"})
check("another user opens the same branch in a workspace of his own", s == 200 and os.path.isdir(os.path.join(work, "data", "workspaces", "bob", "feature_x")))
s, cfg, _ = bob.call("GET", "/api/config")
check("and sees her pushed change", s == 200 and any(g["name"] == "synth.company" and g["value"] == "Hosted Corp" for g in cfg["gcvs"]))
s, dep, _ = bob.call("POST", "/api/vault/deploy", {"env": "nope", "confirm": "nope"})
check("a deployer reaches the deploy (which fails on the missing environments file, not on the role)", s == 400 and "environments" in dep["error"] and "role" not in dep["error"])

carol = Client()
carol.sign_in("carol")
check("a user with no role may read but not write", carol.call("GET", "/api/workspaces")[0] == 200 and carol.call("POST", "/api/workspaces/open", {"branch": "main"})[0] == 403)

s, _, h = alice.call("GET", "/auth/logout")
check("sign-out clears the cookie", s == 303 and "Max-Age=0" in h.get("set-cookie", ""))
check("and the session is gone", alice.call("GET", "/api/session")[0] == 401)

with open(os.path.join(work, "data", "audit.log")) as f:
    lines = [json.loads(l) for l in f if l.strip()]
events = [(l["user"], l["event"], l["outcome"]) for l in lines]
check("the audit log has sign-ins, the workspace, the edit, the commit and the sign-out, per user",
      ("alice", "sign-in", "ok") in events and ("alice", "workspace.open", "ok") in events and ("alice", "op/gcv.set", "ok") in events and ("alice", "commit+push", "ok") in events and ("bob", "workspace.open", "ok") in events and ("alice", "sign-out", "ok") in events)
check("and no line carries a file's contents", all("Hosted Corp" not in json.dumps(l["details"]) for l in lines))
print("smoke-hosted: all passed")
PY
