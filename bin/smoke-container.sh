#!/bin/sh
# The hosted image end to end: bin/smoke-container.sh [image]
# Builds the image (hosted/docker/build.sh) unless one is named, runs it against a bare repository
# and the engine jars mounted from DirXMLDev's lib/, and drives it as an agent (bearer token):
# session, branch cloned inside the container, the tree validated with the engine, an edit, commit
# and push back to the host's repository, the idm CLI inside the container, the audit log.
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
IDM_HOME=${IDM_HOME:-"$HERE/../DirXMLDev"}
if ! docker info >/dev/null 2>&1; then
  echo "smoke-container: skipped (no Docker)"
  exit 0
fi
IMAGE=${1:-}
if [ -z "$IMAGE" ]; then
  IMAGE=dirxml-dev-web:smoke
  "$HERE/hosted/docker/build.sh" "$IMAGE" >/dev/null
fi
WORK=$(mktemp -d)
NAME=idmweb-smoke-$$
trap 'docker rm -f $NAME >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
"$IDM_HOME/bin/idm" import-ldif "$IDM_HOME/src/test/resources/fixtures/synthetic/driverset.ldif" "$WORK/seed/tree" >/dev/null
git -C "$WORK/seed" init -q -b main && git -C "$WORK/seed" -c user.name=s -c user.email=s@x add -A && git -C "$WORK/seed" -c user.name=s -c user.email=s@x commit -q -m seed
git init -q --bare -b main "$WORK/repo.git" && git -C "$WORK/seed" push -q "$WORK/repo.git" main
chmod -R a+rwX "$WORK/repo.git"
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
mkdir -p "$WORK/config" "$WORK/data"
cat > "$WORK/config/hosted.properties" <<ENV
public.url=http://127.0.0.1:$PORT
bind=0.0.0.0
port=8080
data.dir=/var/lib/idmweb
repo.url=/srv/repo.git
repo.tree=tree
environments.file=/etc/idmweb/environments.properties
identity=oidc
oidc.issuer=http://127.0.0.1:1/realms/none
oidc.clientId=idmweb
roles.editor=idm-editors,idm-deployers
roles.deployer=idm-deployers
agents=ci:idm-deployers
agent.ci.tokenEnv=IDMWEB_AGENT_CI
ENV
chmod -R a+rwX "$WORK/config" "$WORK/data"
LIB=$(cd "$IDM_HOME/lib" && pwd -P)
docker run -d --name $NAME -p 127.0.0.1:$PORT:8080 -e IDMWEB_AGENT_CI=ci-agent-token-0123456789 \
  -v "$WORK/config:/etc/idmweb" -v "$WORK/data:/var/lib/idmweb" -v "$WORK/repo.git:/srv/repo.git" -v "$LIB:/opt/idm/lib:ro" "$IMAGE" >/dev/null
i=0
until curl -s "http://127.0.0.1:$PORT/api/session" >/dev/null 2>&1; do i=$((i + 1)); [ $i -gt 60 ] && { docker logs $NAME; exit 1; }; sleep 0.5; done
python3 - "http://127.0.0.1:$PORT" "$WORK" "$NAME" <<'PY'
import json, os, subprocess, sys, urllib.request, urllib.error
base, work, name = sys.argv[1:]
TOKEN = "ci-agent-token-0123456789"

def check(what, ok):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        sys.exit(1)

def call(method, path, body=None, token=TOKEN):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = "Bearer " + token
    req = urllib.request.Request(base + path, method=method, headers=h, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)

check("without a token the container asks for a sign-in", call("GET", "/api/session", token=None)[0] == 401)
s, sess = call("GET", "/api/session")
check("the agent has a session in the container", s == 200 and sess["mode"] == "hosted" and sess["user"]["subject"] == "agent:ci" and sess["core"] is not None)
s, o = call("POST", "/api/workspaces/open", {"branch": "feature/container"})
check("a branch is cloned inside the container", s == 200 and os.path.isdir(os.path.join(work, "data", "workspaces", "repo", "agent_ci", "feature_container", ".git")))
s, v = call("GET", "/api/validate")
check("the tree validates with the mounted engine (the compile check ran)", s == 200 and v["ok"] and v["counts"]["error"] == 0)
rev = call("GET", "/api/session")[1]["revision"]
s, op = call("POST", "/api/op/gcv.set", {"args": {"name": "synth.company", "value": "Container Corp"}, "dryRun": False, "revision": rev})
check("an edit lands", s == 200 and op["written"])
s, c = call("POST", "/api/git/commit", {"message": "From the container", "push": True})
check("commit and push reach the host's repository", s == 200 and c["pushed"] and "From the container" in subprocess.run(["git", "--git-dir", os.path.join(work, "repo.git"), "log", "feature/container", "-1", "--format=%s"], capture_output=True, text=True).stdout)
cli = subprocess.run(["docker", "exec", name, "idm", "validate", "/var/lib/idmweb/workspaces/repo/agent_ci/feature_container/tree", "--json"], capture_output=True, text=True)
check("the idm CLI inside the container validates the same workspace", cli.returncode == 0 and '"ok":true' in cli.stdout.replace(" ", ""))
with open(os.path.join(work, "data", "audit.log")) as f:
    lines = [json.loads(l) for l in f if l.strip()]
check("the audit log names the agent", any(l["user"] == "agent:ci" and l["event"] == "commit+push" for l in lines))
print("smoke-container: all passed")
PY
