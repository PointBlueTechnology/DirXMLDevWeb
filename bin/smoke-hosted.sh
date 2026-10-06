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
agents=ci:idm-deployers;reader:
agent.ci.token=ci-agent-token-0123456789
agent.reader.token=reader-agent-token-0123456789
ENV
IDM_ENVIRONMENTS="$WORK/data/environments.properties" "$HERE/bin/idmweb" serve --hosted "$WORK/hosted.properties" > "$WORK/log" 2>&1 &
PID=$!
i=0
while ! grep -q 'hosted:' "$WORK/log" 2>/dev/null; do
  i=$((i + 1))
  [ $i -gt 60 ] && { echo "server did not start:"; cat "$WORK/log"; exit 1; }
  sleep 0.25
done
HERE="$HERE" python3 - "http://127.0.0.1:$PORT" "$WORK" <<'PY'
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
check("a new branch is cloned from main and opened", s == 200 and opened["branch"] == "feature/x" and os.path.isdir(os.path.join(work, "data", "workspaces", "repo", "alice", "feature_x", ".git")))
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
s, d, _ = alice.call("GET", "/api/git/diff?against=head")
check("the diff since the last commit is empty right after the push", s == 200 and d["ref"] == "HEAD" and d["files"] == [])
s, d, _ = alice.call("GET", "/api/git/diff?against=base")
check("the diff against the base branch shows the pushed change with both sides", s == 200 and d["ref"] == "origin/main" and any(f["file"].endswith("config-values.xml") and "Hosted Corp" in f["after"] and "Hosted Corp" not in f["before"] for f in d["files"]))
s, up, _ = alice.call("POST", "/api/git/update", {})
check("update from main merges (nothing new)", s == 200 and up["merged"])
check("a deploy needs the deployer role", alice.call("POST", "/api/vault/deploy", {"env": "x", "confirm": "x"})[0] == 403)
check("so does changing a connection", alice.call("POST", "/api/credentials/environment", {"name": "x"})[0] == 403)

bob = Client()
bob.sign_in("bob")
s, opened, _ = bob.call("POST", "/api/workspaces/open", {"branch": "feature/x"})
check("another user opens the same branch in a workspace of his own", s == 200 and os.path.isdir(os.path.join(work, "data", "workspaces", "repo", "bob", "feature_x")))
s, cfg, _ = bob.call("GET", "/api/config")
check("and sees her pushed change", s == 200 and any(g["name"] == "synth.company" and g["value"] == "Hosted Corp" for g in cfg["gcvs"]))
s, dep, _ = bob.call("POST", "/api/vault/deploy", {"env": "nope", "confirm": "nope"})
check("a deployer reaches the deploy (which fails on the missing environments file, not on the role)", s == 400 and "environments" in dep["error"] and "role" not in dep["error"])

carol = Client()
carol.sign_in("carol")
check("a user with no role may read but not write", carol.call("GET", "/api/workspaces")[0] == 200 and carol.call("POST", "/api/workspaces/open", {"branch": "main"})[0] == 403)

ci = Client()
s, sess, _ = ci.call("GET", "/api/session", headers={"Authorization": "Bearer ci-agent-token-0123456789"})
check("an agent's bearer token gives it a session with its roles", s == 200 and sess["user"]["subject"] == "agent:ci" and sess["user"]["deployer"])
s, opened, _ = ci.call("POST", "/api/workspaces/open", {"branch": "feature/x"}, headers={"Authorization": "Bearer ci-agent-token-0123456789"}, csrf=False)
check("and it writes without a CSRF token (no cookie, no CSRF)", s == 200 and opened["branch"] == "feature/x")
check("a wrong token is refused", ci.call("GET", "/api/session", headers={"Authorization": "Bearer nope-nope-nope-nope"})[0] == 401)
s, _, _ = ci.call("POST", "/api/workspaces/open", {"branch": "feature/x"}, headers={"Authorization": "Bearer reader-agent-token-0123456789"}, csrf=False)
check("an agent without a role reads only", s == 403)

s, _, h = alice.call("GET", "/auth/logout")
check("sign-out clears the cookie", s == 303 and "Max-Age=0" in h.get("set-cookie", ""))
check("and the session is gone", alice.call("GET", "/api/session")[0] == 401)

# a second server with no repository: the first-run setup
import subprocess as sp, socket, time
s2 = socket.socket(); s2.bind(("127.0.0.1", 0)); port2 = s2.getsockname()[1]; s2.close()
os.makedirs(os.path.join(work, "data2"))
with open(os.path.join(work, "hosted2.properties"), "w") as f:
    f.write("public.url=http://127.0.0.1:%d\nbind=127.0.0.1\nport=%d\ndata.dir=%s/data2\nenvironments.file=%s/data2/environments.properties\nidentity=token\ntoken.value=smoke-setup-token-0123456789\ntoken.user=solo\nroles.editor=*\nroles.deployer=*\n" % (port2, port2, work, work))
here = os.environ["HERE"]
p2 = sp.Popen([os.path.join(here, "bin", "idmweb"), "serve", "--hosted", os.path.join(work, "hosted2.properties")], stdout=open(os.path.join(work, "log2"), "w"), stderr=sp.STDOUT, env={**os.environ, "IDM_ENVIRONMENTS": os.path.join(work, "data2", "environments.properties")})
try:
    for _ in range(80):
        if os.path.exists(os.path.join(work, "log2")) and "hosted:" in open(os.path.join(work, "log2")).read():
            break
        time.sleep(0.25)
    base2 = "http://127.0.0.1:%d" % port2
    solo = Client()
    def call2(method, path, body=None, headers=None, raw=False, csrf=True):
        h = {"Content-Type": "application/json"}
        if solo.cookie: h["Cookie"] = solo.cookie
        if csrf and solo.csrf and method != "GET": h["X-IDMWeb-CSRF"] = solo.csrf
        h.update(headers or {})
        data = None if body is None else (body if raw else json.dumps(body).encode())
        req = urllib.request.Request(base2 + path, method=method, headers=h, data=data)
        try:
            with urllib.request.build_opener(NoRedirect()).open(req) as r:
                t = r.read().decode(); return r.status, (json.loads(t) if t.startswith("{") else t), {k.lower(): v for k, v in r.headers.items()}
        except urllib.error.HTTPError as e:
            t = e.read().decode(); return e.code, (json.loads(t) if t.startswith("{") else t), {k.lower(): v for k, v in e.headers.items()}
    s, _, h = call2("POST", "/auth/callback", body=b"token=smoke-setup-token-0123456789&next=/", raw=True, headers={"Content-Type": "application/x-www-form-urlencoded"})
    check("first run: the token provider signs the person in", s == 303 and "idmweb_session=" in h.get("set-cookie", ""))
    solo.cookie = h["set-cookie"].split(";")[0]
    s, sess, _ = call2("GET", "/api/session"); solo.csrf = sess["csrf"]
    check("first run: the session says setup is needed", s == 200 and sess["setup"] and sess["workspace"] is None)
    check("first run: /api/setup agrees and the connections view is reachable", call2("GET", "/api/setup")[1]["needed"] and call2("GET", "/api/credentials")[0] == 200)
    check("first run: a bad directory is refused in words", "not a directory" in call2("POST", "/api/setup/directory", {"path": "/nope/nope"})[1]["error"])
    plain = os.path.join(work, "plain"); import shutil; shutil.copytree(os.path.join(work, "seed", "tree"), os.path.join(plain, "tree"))
    s, r = call2("POST", "/api/setup/directory", {"path": plain})[:2]
    check("first run: a plain directory becomes a repository in place", s == 200 and r["inPlace"] == plain and r["tree"] == "tree" and os.path.isdir(os.path.join(plain, ".git")))
    s, sess, _ = call2("GET", "/api/session")
    check("first run: setup is done and remembered in the configuration", not sess["setup"] and "repo.inPlace=" + plain in open(os.path.join(work, "hosted2.properties")).read())
    s, o, _ = call2("POST", "/api/workspaces/open", {"branch": "main"})
    check("first run: the in-place checkout is the workspace", s == 200 and o["workspace"] == "plain/in-place")
    check("first run: the tree is served from it", call2("GET", "/api/outline")[1]["drivers"][0]["name"] == "Loop")
    rev = call2("GET", "/api/session")[1]["revision"]
    s, c = call2("POST", "/api/op/policy.add", {"args": {"name": "sub-ctp-New", "driver": "Loop", "scope": "subscriber", "link": "subscriber-command"}, "dryRun": False, "revision": rev})[:2]
    check("a policy is created and linked (the New menu's operation)", s == 200 and c["written"] and any(f.endswith("sub-ctp-New.policy.xml") for f in c["changedFiles"]))
    s, st, _ = call2("GET", "/api/git/status")
    check("git status in place sees the new policy", s == 200 and st["branch"] == "main" and any("sub-ctp-New" in x["file"] for x in st["changed"]))
    # a second project on the same server: the bare repository of the first server, named
    s, r = call2("POST", "/api/setup/existing", {"project": "second", "path": os.path.join(work, "repo.git")})[:2]
    check("a second project is added (a bare repository, cloned per branch)", s == 200 and r["project"] == "second" and r["tree"] == "tree")
    s, ws, _ = call2("GET", "/api/workspaces?project=second")
    check("the server lists both projects and the second's branches", [p["name"] for p in ws["projects"]] == ["plain", "second"] and "feature/x" in ws["branches"] and ws["project"] == "second")
    s, o, _ = call2("POST", "/api/workspaces/open", {"project": "second", "branch": "feature/x"})
    check("a branch of the second project opens in its own workspace", s == 200 and o["workspace"] == "second/solo/feature_x" and os.path.isdir(os.path.join(work, "data2", "workspaces", "second", "solo", "feature_x", ".git")))
    s, cfg, _ = call2("GET", "/api/config")
    check("and holds that project's tree (Alice's pushed value)", s == 200 and any(g["name"] == "synth.company" and g["value"] == "Hosted Corp" for g in cfg["gcvs"]))
    s, sess, _ = call2("GET", "/api/session")
    check("the session says which project is open", sess["project"] == "second")
    s, o, _ = call2("POST", "/api/workspaces/open", {"project": "plain", "branch": "main"})
    check("switching back to the first project's in-place workspace", s == 200 and o["workspace"] == "plain/in-place")
    conf = open(os.path.join(work, "hosted2.properties")).read()
    check("both projects are in the configuration", "projects=plain,second" in conf and "project.second.repo.url=" in conf and "project.plain.repo.inPlace=" in conf)
    # the first server's configuration used the single repo.* keys: adding a project there keeps the first one
    s, r, _ = bob.call("POST", "/api/setup/existing", {"project": "extra", "path": os.path.join(work, "repo.git")})
    conf1 = open(os.path.join(work, "hosted.properties")).read()
    check("adding a project to a server set up with the old repo.* keys keeps its first project", s == 200 and "projects=repo,extra" in conf1 and "project.repo.repo.url=" in conf1 and "repo.url=" not in conf1.replace("project.repo.repo.url=", "").replace("project.extra.repo.url=", ""))
    check("a duplicate project name is refused", "exists already" in call2("POST", "/api/setup/directory", {"project": "plain", "path": plain})[1]["error"])
    s, rm = call2("POST", "/api/setup/remove", {"project": "second"})[:2]
    check("a project can be removed (its files stay)", s == 200 and rm["removed"] == "second" and "projects=plain\n" in open(os.path.join(work, "hosted2.properties")).read())
finally:
    p2.terminate()

with open(os.path.join(work, "data", "audit.log")) as f:
    lines = [json.loads(l) for l in f if l.strip()]
events = [(l["user"], l["event"], l["outcome"]) for l in lines]
check("the audit log has sign-ins, the workspace, the edit, the commit and the sign-out, per user",
      ("alice", "sign-in", "ok") in events and ("alice", "workspace.open", "ok") in events and ("alice", "op/gcv.set", "ok") in events and ("alice", "commit+push", "ok") in events and ("bob", "workspace.open", "ok") in events and ("alice", "sign-out", "ok") in events and ("agent:ci", "workspace.open", "ok") in events)
check("and no line carries a file's contents", all("Hosted Corp" not in json.dumps(l["details"]) for l in lines))
print("smoke-hosted: all passed")
PY
