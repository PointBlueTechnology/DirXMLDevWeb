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
STUB=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
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
repo.provider=github
repo.apiUrl=http://127.0.0.1:$STUB
repo.token=smoke-repo-token
environments.file=$WORK/data/environments.properties
identity=none
none.users=alice:Alice Example:alice@example.com:idm-editors;bob:Bob Deployer:bob@example.com:idm-deployers;carol:Carol Reader:carol@example.com:
roles.editor=idm-editors,idm-deployers
roles.deployer=idm-deployers
setup.roots=$WORK
agents=ci:idm-deployers;reader:
agent.ci.token=ci-agent-token-0123456789
agent.reader.token=reader-agent-token-0123456789
audit.maxBytes=2KB
audit.keep=0
ENV
IDMWEB_AGENT_KIT="$HERE/hosted/agent-kit" IDM_ENVIRONMENTS="$WORK/data/environments.properties" "$HERE/bin/idmweb" serve --hosted "$WORK/hosted.properties" > "$WORK/log" 2>&1 &
PID=$!
i=0
while ! grep -q 'hosted:' "$WORK/log" 2>/dev/null; do
  i=$((i + 1))
  [ $i -gt 60 ] && { echo "server did not start:"; cat "$WORK/log"; exit 1; }
  sleep 0.25
done
HERE="$HERE" python3 - "http://127.0.0.1:$PORT" "$WORK" "$STUB" <<'PY'
import json, os, subprocess, sys, urllib.request, urllib.error, urllib.parse
base, work = sys.argv[1], sys.argv[2]
# #35: a stub of GitHub's pulls API, recording what it is asked
import threading, http.server
stub_seen, stub_pulls = [], []
class StubGitHub(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def answer(self, code, body):
        out = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)
    def do_GET(self):
        stub_seen.append(("GET", self.path, self.headers.get("Authorization"), None))
        self.answer(200, [p for p in stub_pulls if p["state"] == "open"])
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
        stub_seen.append(("POST", self.path, self.headers.get("Authorization"), body))
        p = {"number": len(stub_pulls) + 1, "html_url": "https://github.com/smoke/config/pull/%d" % (len(stub_pulls) + 1), "state": "open", "title": body.get("title"), "draft": body.get("draft", False)}
        stub_pulls.append(p)
        self.answer(201, p)
stub_server = http.server.HTTPServer(("127.0.0.1", int(sys.argv[3])), StubGitHub)
threading.Thread(target=stub_server.serve_forever, daemon=True).start()

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
# #38 / #41: what an editor may not do on the host
s, r, _ = alice.call("POST", "/api/credentials/resolve", {"command": "id"})
check("an editor may not run a command to test a secret manager (403)", s == 403 and "deployer" in r.get("error", ""))
check("attaching a host path to a project needs the deployer role (403 for an editor)", alice.call("POST", "/api/setup/existing", {"project": "x", "path": work})[0] == 403)
check("an editor may not read the audit log (#42)", alice.call("GET", "/api/audit")[0] == 403)
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
s, st, _ = alice.call("GET", "/api/git/status")
check("after the push the branch tracks its remote copy, nothing left to push (#35)", s == 200 and st["upstream"] == "origin/feature/x" and st["ahead"] == 0)
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
check("so does writing a Designer project to a host path", alice.call("POST", "/api/export/project", {"mode": "new", "path": "/tmp/x", "dryRun": True})[0] == 403)
# #35: pull requests through the provider's API (a stub of GitHub's)
s, pr, _ = alice.call("GET", "/api/git/pull-request")
check("pull request: a local remote is not a provider, so the compare page stays", s == 200 and not pr["available"] and "GitHub or GitLab" in pr["reason"])
check("pull request: and nothing is created for it", alice.call("POST", "/api/git/pull-request", {"title": "x"})[0] == 400)
ws = os.path.join(work, "data", "workspaces", "repo", "alice", "feature_x")
subprocess.run(["git", "-C", ws, "remote", "set-url", "origin", "https://github.com/smoke/config.git"], check=True)
subprocess.run(["git", "-C", ws, "remote", "set-url", "--push", "origin", os.path.join(work, "repo.git")], check=True)
s, pr, _ = alice.call("GET", "/api/git/pull-request")
check("pull request: on GitHub, as the project's token, pushed, none open yet, a title from the branch", s == 200 and pr["available"] and pr["provider"] == "GitHub" and pr["as"] == "the project's repository token" and pr["pushed"] and pr["request"] is None and pr["title"] == "Rename the company" and "- Rename the company" in pr["body"])
check("pull request: the provider was asked for the branch's open one with the project's token", stub_seen and stub_seen[-1][0] == "GET" and stub_seen[-1][1] == "/repos/smoke/config/pulls?state=open&head=smoke%3Afeature%2Fx" and stub_seen[-1][2] == "Bearer smoke-repo-token")
check("pull request: a title is needed", alice.call("POST", "/api/git/pull-request", {"title": " "})[0] == 400)
s, made, _ = alice.call("POST", "/api/git/pull-request", {"title": "Rename the company", "body": "- Rename the company", "draft": False})
sent = stub_seen[-1][3]
check("pull request: created on GitHub, head and base and title as given", s == 200 and made["ok"] and made["request"]["number"] == 1 and sent["head"] == "feature/x" and sent["base"] == "main" and sent["title"] == "Rename the company" and sent["draft"] is False)
check("pull request: the description says who opened it with the project's token", sent["body"].endswith("Opened by Alice Example (alice@example.com) from DirXMLDevWeb."))
s, pr, _ = alice.call("GET", "/api/git/pull-request")
check("pull request: the branch's open one is shown from then on", s == 200 and pr["request"]["number"] == 1 and pr["request"]["url"] == "https://github.com/smoke/config/pull/1")
# #35 P2: a person's own provider token, by host
s, gt, _ = alice.call("GET", "/api/credentials/git")
check("git tokens: a local remote names no provider host", s == 200 and gt["hosts"] == [])
check("git tokens: a host must look like one", alice.call("POST", "/api/credentials/git", {"host": "../x", "store": "file", "token": "t"})[0] == 400)
s, saved, _ = alice.call("POST", "/api/credentials/git", {"host": "github.com", "store": "file", "token": "alice-own-token"})
check("git tokens: her token for github.com is kept in her own file, owner-only, and not given back", s == 200 and saved["store"] == "file" and "alice-own-token" not in json.dumps(saved))
own = os.path.join(work, "data", "users", "alice", "git.properties")
check("git tokens: the file is hers and owner-only", os.path.isfile(own) and oct(os.stat(own).st_mode & 0o777) == "0o600")
s, pr, _ = alice.call("GET", "/api/git/pull-request")
check("pull request: with her own token it is created as her", s == 200 and pr["as"] == "Alice Example" and stub_seen[-1][2] == "Bearer alice-own-token")
s, made, _ = alice.call("POST", "/api/git/pull-request", {"title": "Mine", "body": "by me", "draft": True})
check("pull request: sent with her token, no 'Opened by' line (the provider shows her)", s == 200 and made["ok"] and stub_seen[-1][2] == "Bearer alice-own-token" and stub_seen[-1][3]["body"] == "by me" and stub_seen[-1][3]["draft"] is True)
# a variable reference saved before references were a deployer's: kept, never read for her
gitfile = os.path.join(work, "data", "users", "alice", "git.properties")
with open(gitfile) as f:
    kept = [l for l in f if not l.startswith("github.com.token")]
with open(gitfile, "w") as f:
    f.writelines(kept + ["github.com.tokenEnv=PATH\n"])
s, pr, _ = alice.call("GET", "/api/git/pull-request")
check("pull request: a token that cannot be read falls back to the project's, and says so", s == 200 and pr["as"] == "the project's repository token" and "could not be read" in pr.get("personalTokenError", "") and "only a deployer" in pr.get("personalTokenError", ""))
s, rm, _ = alice.call("POST", "/api/credentials/git/remove", {"host": "github.com"})
s, pr, _ = alice.call("GET", "/api/git/pull-request")
check("git tokens: forgotten, the project's token is used again", rm["removed"] and pr["as"] == "the project's repository token" and "personalTokenError" not in pr)
# a reference (a variable, a command) is resolved on the server as the server: a deployer's only
s, r, _ = alice.call("POST", "/api/credentials/git", {"host": "github.com", "store": "command:echo x"})
check("an editor may not save a command reference for a token (403)", s == 403 and "only a deployer" in r.get("error", ""))
s, r, _ = alice.call("POST", "/api/credentials/git", {"host": "github.com", "store": "env:PATH"})
check("nor an environment variable reference for a token (403)", s == 403 and "only a deployer" in r.get("error", ""))
s, r, _ = alice.call("POST", "/api/credentials/mine", {"name": "cmdtest", "url": "ldaps://127.0.0.1:1", "bindDn": "cn=a,o=x", "driverSet": "cn=ds,o=x", "passwordStore": "command:echo x"})
check("nor for her own connection's password (403)", s == 403 and "only a deployer" in r.get("error", ""))
s, r, _ = alice.call("POST", "/api/credentials/mine", {"name": "cmdtest", "url": "ldaps://127.0.0.1:1", "bindDn": "cn=a,o=x", "driverSet": "cn=ds,o=x", "passwordStore": "env:PATH"})
check("nor an environment variable for it (403)", s == 403 and "only a deployer" in r.get("error", ""))
s, r, _ = alice.call("POST", "/api/credentials/mine", {"name": "cmdtest", "url": "ldaps://127.0.0.1:1", "bindDn": "cn=a,o=x", "driverSet": "cn=ds,o=x", "passwordStore": "file", "password": "pw"})
check("a password kept in her own file stays hers to use", s == 200)
mine = os.path.join(work, "data", "users", "alice", "environments.properties")
with open(mine) as f:
    kept = [l for l in f if not l.startswith("cmdtest.password=")]
with open(mine, "w") as f:
    f.writelines(kept + ["cmdtest.passwordEnv=PATH\n"])
s, r, _ = alice.call("POST", "/api/credentials/resolve", {"env": "cmdtest"})
check("a variable reference saved before is never read for her", s == 200 and r["ok"] is False and "environment variable, which only a deployer" in r.get("message", ""))
alice.call("POST", "/api/credentials/mine/remove", {"name": "cmdtest"})
with open(os.path.join(work, "data", "users", "alice", "git.properties"), "a") as f:
    f.write("github.com.tokenCommand=touch " + os.path.join(work, "ran-by-alice") + "; echo t\n")
s, pr, _ = alice.call("GET", "/api/git/pull-request")
check("one saved before is never run: the project's token stands in and she is told why", s == 200 and pr["as"] == "the project's repository token" and "only a deployer" in pr.get("personalTokenError", "") and not os.path.exists(os.path.join(work, "ran-by-alice")))
s, gt, _ = alice.call("GET", "/api/credentials/git")
alice.call("POST", "/api/credentials/git/remove", {"host": "github.com"})

bob = Client()
bob.sign_in("bob")
s, opened, _ = bob.call("POST", "/api/workspaces/open", {"branch": "feature/x"})
check("another user opens the same branch in a workspace of his own", s == 200 and os.path.isdir(os.path.join(work, "data", "workspaces", "repo", "bob", "feature_x")))
s, r, _ = bob.call("POST", "/api/credentials/git", {"host": "github.com", "store": "command:echo bob-token"})
check("a deployer may keep a token as a command reference", s == 200 and r["store"] == "command")
bob.call("POST", "/api/credentials/git/remove", {"host": "github.com"})
check("a deployer's Designer project write stays under setup.roots", bob.call("POST", "/api/export/project", {"mode": "new", "path": "/etc/idmweb-x", "dryRun": True})[0] == 400)
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

# personal agent tokens and the MCP endpoint (docs/agents.md): alice's agent acts as alice
s, made, _ = alice.call("POST", "/api/agent-tokens", {"label": "claude", "days": 30})
check("a person makes a token for her agent; it is shown once", s == 200 and str(made.get("token", "")).startswith("idmw_") and made["label"] == "claude")
mine = {"Authorization": "Bearer " + made["token"]}
s, sess, _ = ci.call("GET", "/api/session", headers=mine)
check("her agent signs in as her, with her roles", s == 200 and sess["user"]["subject"] == "alice" and sess["user"]["editor"] and not sess["user"]["deployer"])
check("an agent cannot make tokens", ci.call("POST", "/api/agent-tokens", {"label": "x"}, headers=mine, csrf=False)[0] == 403)
s, lst, _ = alice.call("GET", "/api/agent-tokens")
check("her token list shows the label, never the token", s == 200 and [t["label"] for t in lst["tokens"]] == ["claude"] and made["token"] not in json.dumps(lst))
def mcp(body, headers=None):
    h = dict(mine)
    h.update(headers or {})
    return ci.call("POST", "/mcp", body, headers=h, csrf=False)
s, init, _ = mcp({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "smoke", "version": "1"}}})
check("MCP: initialize answers with the protocol and the rules", s == 200 and init["result"]["protocolVersion"] == "2025-06-18" and "plan_deploy" in init["result"]["instructions"])
s, tl, _ = mcp({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
names = [t["name"] for t in tl["result"]["tools"]]
check("MCP: the tools are listed, the vault writes marked destructive", s == 200 and "run_operations" in names and "deploy" in names
      and [t for t in tl["result"]["tools"] if t["name"] == "deploy"][0]["annotations"]["destructiveHint"])
s, r, _ = mcp({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "session", "arguments": {}}})
text = r["result"]["content"][0]["text"]
check("MCP: a tool call acts as her, and the page's CSRF token stays out", s == 200 and not r["result"]["isError"] and '"subject":"alice"' in text and "csrf" not in text)
s, r, _ = mcp({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "outline", "arguments": {}}})
check("MCP: her branch's tree is read through the API", s == 200 and not r["result"]["isError"] and "Loop" in r["result"]["content"][0]["text"])
s, r, _ = mcp({"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "deploy", "arguments": {"env": "lab", "confirm": "lab"}}})
check("MCP: a vault write is the API's to refuse (an editor, not a deployer)", s == 200 and r["result"]["isError"] and "deployer" in r["result"]["content"][0]["text"])
s, _, _ = mcp({"jsonrpc": "2.0", "id": 6, "method": "tools/list"}, headers={"Host": "evil.example"})
check("MCP: another host is refused", s == 403)
s, _, _ = anon.call("POST", "/mcp", {"jsonrpc": "2.0", "id": 7, "method": "tools/list"}, csrf=False)
check("MCP: without a token it says to sign in", s == 401)
check("MCP: GET has no stream (405)", ci.call("GET", "/mcp", headers=mine)[0] == 405)
page_branch = alice.call("GET", "/api/session")[1]["branch"]
s, ob, _ = mcp({"jsonrpc": "2.0", "id": 13, "method": "tools/call", "params": {"name": "open_branch", "arguments": {"branch": "feature/agent-moved"}}})
s, r, _ = mcp({"jsonrpc": "2.0", "id": 14, "method": "tools/call", "params": {"name": "session", "arguments": {}}})
check("MCP: open_branch moves the agent to another branch", not ob["result"]["isError"] and json.loads(r["result"]["content"][0]["text"])["branch"] == "feature/agent-moved")
check("MCP: ... and the page stays on its own", alice.call("GET", "/api/session")[1]["branch"] == page_branch)
s, lb, _ = mcp({"jsonrpc": "2.0", "id": 15, "method": "tools/call", "params": {"name": "list_branches", "arguments": {}}})
check("MCP: list_branches names the branch the agent opened as one of yours", "feature/agent-moved" in lb["result"]["content"][0]["text"])
s, bad, _ = mcp({"jsonrpc": "2.0", "id": 16, "method": "tools/call", "params": {"name": "open_branch", "arguments": {"branch": "../escape"}}})
check("MCP: a bad branch name is refused", bad["result"]["isError"])
mcp({"jsonrpc": "2.0", "id": 17, "method": "tools/call", "params": {"name": "open_branch", "arguments": {"branch": page_branch}}})
s, rl, _ = mcp({"jsonrpc": "2.0", "id": 8, "method": "resources/list"})
uris = [x["uri"] for x in rl["result"]["resources"]]
check("MCP: the agent kit is listed as resources", s == 200 and "dirxmldev://kit/AGENTS.md" in uris)
s, rr, _ = mcp({"jsonrpc": "2.0", "id": 9, "method": "resources/read", "params": {"uri": "dirxmldev://kit/AGENTS.md"}})
check("MCP: a resource reads with this server's MCP address filled in", s == 200 and (base + "/mcp") in rr["result"]["contents"][0]["text"] and "{{" not in rr["result"]["contents"][0]["text"])
s, bad, _ = mcp({"jsonrpc": "2.0", "id": 10, "method": "resources/read", "params": {"uri": "dirxmldev://kit/../../hosted.properties"}})
check("MCP: a resource outside the kit is refused", s == 200 and "error" in bad)
s, pl, _ = mcp({"jsonrpc": "2.0", "id": 11, "method": "prompts/list"})
check("MCP: the setup and orient prompts are listed", s == 200 and [p["name"] for p in pl["result"]["prompts"]] == ["setup", "orient"])
s, pg, _ = mcp({"jsonrpc": "2.0", "id": 12, "method": "prompts/get", "params": {"name": "setup", "arguments": {"skills_dir": ".claude/skills"}}})
st = pg["result"]["messages"][0]["content"]["text"]
check("MCP: the setup prompt reads the rules, installs the skills where asked, then orients", s == 200 and "dirxmldev://kit/AGENTS.md" in st and ".claude/skills/<the path" in st and "validate" in st)
s, lst, _ = alice.call("GET", "/api/agent-tokens")
check("the page's setup prompt is the MCP prompt's, without a secret", s == 200 and lst["setupPrompt"].startswith("Set yourself up") and "idmw_" not in lst["setupPrompt"])
s, _, _ = alice.call("POST", "/api/agent-tokens/revoke", {"id": made["id"]})
check("she revokes the token", s == 200)
check("a revoked token no longer signs in", ci.call("GET", "/api/session", headers=mine)[0] == 401)

s, _, h = alice.call("GET", "/auth/logout")
check("sign-out clears the cookie", s == 303 and "Max-Age=0" in h.get("set-cookie", ""))
check("and the session is gone", alice.call("GET", "/api/session")[0] == 401)

# a second server with no repository: the first-run setup
import subprocess as sp, socket, time
s2 = socket.socket(); s2.bind(("127.0.0.1", 0)); port2 = s2.getsockname()[1]; s2.close()
os.makedirs(os.path.join(work, "data2"))
with open(os.path.join(work, "hosted2.properties"), "w") as f:
    f.write("public.url=http://127.0.0.1:%d\nbind=127.0.0.1\nport=%d\ndata.dir=%s/data2\nenvironments.file=%s/data2/environments.properties\nidentity=token\ntoken.value=smoke-setup-token-0123456789\ntoken.user=solo\nroles.editor=*\nroles.deployer=*\nsetup.roots=%s\n" % (port2, port2, work, work, work))
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
    check("first run: a bad directory is refused in words (outside the roots is said first, without probing it)", "outside" in call2("POST", "/api/setup/directory", {"path": "/nope/nope"})[1]["error"])
    check("first run: a missing directory under the roots is refused in words", "not a directory" in call2("POST", "/api/setup/directory", {"path": os.path.join(work, "nope")})[1]["error"])
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
    s, r, _ = bob.call("POST", "/api/setup/directory", {"project": "outside", "path": "/etc"})
    check("a deployer may attach only under setup.roots (#41)", s == 400 and "outside" in r.get("error", ""))
    # #42: the audit log, deployers only
    import datetime
    def when(t):   # 3, 6 or 9 fraction digits: compare as times, not text (#161)
        return datetime.datetime.fromisoformat(t.replace("Z", "+00:00"))
    s, a, _ = bob.call("GET", "/api/audit?limit=50")
    check("a deployer reads the audit log (newest first, sign-ins among them)", s == 200 and len(a["entries"]) > 0 and any(e["event"] == "sign-in" for e in a["entries"]) and when(a["entries"][0]["time"]) >= when(a["entries"][-1]["time"]))
    # #161: rotated by size (2KB here, all kept); the view reads across the files, newest first
    logs = sorted(f for f in os.listdir(os.path.join(work, "data")) if f.startswith("audit.log"))
    current = len(open(os.path.join(work, "data", "audit.log")).read().splitlines())
    whole = all(l.startswith("{") and l.endswith("}") for f in logs for l in open(os.path.join(work, "data", f)).read().splitlines())
    check("the audit log rotates at audit.maxBytes, every line whole", "audit.log.1" in logs and whole
          and all(os.path.getsize(os.path.join(work, "data", f)) <= 2 * 1024 for f in logs))
    s, a, _ = bob.call("GET", "/api/audit?limit=2000")
    check("the Audit view reads past the current file into the rotated ones", s == 200 and len(a["entries"]) > current)
    s, a, _ = bob.call("GET", "/api/audit?event=sign-in&user=alice")
    check("filtered by event and user", s == 200 and a["entries"] and all(e["event"] == "sign-in" and e["user"] == "alice" for e in a["entries"]))
    s, a, _ = bob.call("GET", "/api/audit?event=git-token")
    check("a person's token change is audited with the host and the form, never the value", s == 200 and a["entries"] and a["entries"][-1]["details"].get("host") == "github.com" and "alice-own-token" not in json.dumps(a["entries"]))
    s, a, _ = bob.call("GET", "/api/audit?event=pull-request")
    by_number = {e["details"].get("number"): e["details"] for e in a["entries"]}
    check("each pull request is audited with its number and the account used, no token", s == 200 and by_number.get("1", {}).get("as") == "the project's repository token" and by_number.get("2", {}).get("as") == "Alice Example" and "smoke-repo-token" not in json.dumps(a["entries"]) and "alice-own-token" not in json.dumps(a["entries"]))
    check("no line carries a file's contents", all("content" not in json.dumps(e.get("details", {})) for e in bob.call("GET", "/api/audit?limit=500")[1]["entries"]))
    check("a duplicate project name is refused", "exists already" in call2("POST", "/api/setup/directory", {"project": "plain", "path": plain})[1]["error"])
    s, rm = call2("POST", "/api/setup/remove", {"project": "second"})[:2]
    check("a project can be removed (its files stay)", s == 200 and rm["removed"] == "second" and "projects=plain\n" in open(os.path.join(work, "hosted2.properties")).read())
finally:
    # #37 / #50: a restart signs nobody out and brings the workspace back
    call2("POST", "/api/workspaces/open", {"branch": "main"})
    before = call2("GET", "/api/session")[1]
    p2.terminate(); p2.wait()
    open(os.path.join(work, "log2"), "w").close()
    p2 = sp.Popen([os.path.join(here, "bin", "idmweb"), "serve", "--hosted", os.path.join(work, "hosted2.properties")], stdout=open(os.path.join(work, "log2"), "w"), stderr=sp.STDOUT, env={**os.environ, "IDM_ENVIRONMENTS": os.path.join(work, "data2", "environments.properties")})
    for _ in range(80):
        if "hosted:" in open(os.path.join(work, "log2")).read():
            break
        time.sleep(0.25)
    s, after = call2("GET", "/api/session")[:2]
    check("after a restart the same cookie is still a session (sessions.json), with the workspace back (%s -> %s)" % (before.get("workspace"), after.get("workspace")), s == 200 and after.get("user", {}).get("name") == before.get("user", {}).get("name") and after.get("workspace") and after.get("workspace") == before.get("workspace"))
    check("sessions.json is the owner's only", oct(os.stat(os.path.join(work, "data2", "sessions.json")).st_mode)[-3:] == "600")
    p2.terminate()

# the whole log, oldest first: audit.log.N … audit.log.1, then audit.log (rotated, #161)
rotated = sorted((int(f.rsplit(".", 1)[1]) for f in os.listdir(os.path.join(work, "data")) if f.startswith("audit.log.")), reverse=True)
lines = []
for f in ["audit.log.%d" % n for n in rotated] + ["audit.log"]:
    with open(os.path.join(work, "data", f)) as fh:
        lines += [json.loads(l) for l in fh if l.strip()]
events = [(l["user"], l["event"], l["outcome"]) for l in lines]
check("the audit log has sign-ins, the workspace, the edit, the commit and the sign-out, per user",
      ("alice", "sign-in", "ok") in events and ("alice", "workspace.open", "ok") in events and ("alice", "op/gcv.set", "ok") in events and ("alice", "commit+push", "ok") in events and ("bob", "workspace.open", "ok") in events and ("alice", "sign-out", "ok") in events and ("agent:ci", "workspace.open", "ok") in events)
check("and no line carries a file's contents", all("Hosted Corp" not in json.dumps(l["details"]) for l in lines))
check("her agent's calls are hers, marked via its token", any(l["user"] == "alice" and l.get("via") == "claude" for l in lines)
      and any(l["user"] == "alice" and l["event"] == "agent-token-create" for l in lines) and all(made["token"] not in json.dumps(l) for l in lines))
print("smoke-hosted: all passed")
PY
# the local install's `setup` (docs/quickstart.md), written into a temporary folder
mkdir -p "$WORK/setup"
"$HERE/bin/idmweb" setup --dir "$WORK/setup" --port 18099 --user smoke > "$WORK/setup.out" 2>&1 || { cat "$WORK/setup.out"; echo "FAIL setup"; exit 1; }
if grep -q "container_name: idmweb" "$WORK/setup/compose.yml" && grep -q "^IDMWEB_TOKEN=" "$WORK/setup/idmweb.env" \
   && grep -q "^IDMWEB_PORT=18099" "$WORK/setup/.env" && grep -q "auth/login#signin=" "$WORK/setup.out"; then
  echo "ok   setup: the local install is written (compose.yml, .env, tokens, the sign-in link)"
else
  echo "FAIL setup: the local install is incomplete"; exit 1
fi
