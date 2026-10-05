#!/bin/sh
# End-to-end check of the server against a real tree: bin/smoke.sh
# Builds a scratch tree from DirXMLDev's committed synthetic fixture, serves it on an ephemeral
# port, and exercises every endpoint, the security gates and the write path. Needs what
# bin/idmweb needs (a built DirXMLDev with its engine jars); exits non-zero on the first failure.
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
IDM_HOME=${IDM_HOME:-"$HERE/../DirXMLDev"}
WORK=$(mktemp -d)
trap 'kill $PID 2>/dev/null || true; rm -rf "$WORK"' EXIT
"$IDM_HOME/bin/idm" import-ldif "$IDM_HOME/src/test/resources/fixtures/synthetic/driverset.ldif" "$WORK/tree" >/dev/null
"$HERE/bin/idmweb" serve "$WORK/tree" --no-open > "$WORK/log" 2>&1 &
PID=$!
i=0
while ! grep -q '#token=' "$WORK/log" 2>/dev/null; do
  i=$((i + 1))
  [ $i -gt 40 ] && { echo "server did not start:"; cat "$WORK/log"; exit 1; }
  sleep 0.25
done
BASE=$(grep -oE 'http://127.0.0.1:[0-9]+' "$WORK/log" | head -1)
TOKEN=$(grep -oE 'token=[0-9a-f]+' "$WORK/log" | head -1 | cut -d= -f2)
python3 - "$BASE" "$TOKEN" <<'PY'
import json, sys, urllib.request, urllib.error
base, token = sys.argv[1], sys.argv[2]

def call(method, path, body=None, headers=None):
    h = {"X-IDMWeb-Token": token, "Content-Type": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(base + path, method=method, headers=h, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)

def check(what, ok):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        sys.exit(1)

check("no token is refused", call("GET", "/api/session", headers={"X-IDMWeb-Token": ""})[0] == 403)
check("another host is refused", call("GET", "/api/session", headers={"Host": "evil.example:1"})[0] == 403)
check("another origin is refused", call("GET", "/api/session", headers={"Origin": "https://evil.example"})[0] == 403)
s, session = call("GET", "/api/session")
check("session names the tree and a revision", s == 200 and session["revision"] and session["name"] == "DirXMLDevWeb")
s, outline = call("GET", "/api/outline")
d = outline["drivers"][0]
check("outline: driver, policies, forms, PRD", d["name"] == "Loop" and len(d["policies"]["subscriber"]) == 1 and len(d["forms"]) == 2 and len(d["prds"]) == 1)
s, art = call("GET", "/api/artifact?path=library/lib-NormalizeTitle")
check("artifact: source and the link that refers to it", art["kind"] == "dirxml-script" and "<policy>" in art["content"] and art["refs"][0]["from"] == "drivers/Loop")
s, f = call("GET", "/api/file?file=drivers/Loop/driver-filter.xml")
check("file: read from the tree", s == 200 and "<filter" in f["content"])
check("file: outside the tree is refused", call("GET", "/api/file?file=../../etc/passwd")[0] == 400)
s, fb = call("GET", "/api/fishbone?driver=Loop")
check("fishbone: the subscriber command set holds two policies", [len(b["policies"]) for b in fb["subscriber"] if b["key"] == "subscriber-command"] == [2])
s, v = call("GET", "/api/validate")
check("validation: clean", v["ok"] and v["counts"]["error"] == 0)
s, cat = call("GET", "/api/catalog")
check("catalog: the core's operations", len(cat["operations"]) >= 60 and any(o["name"] == "artifact.set-content" for o in cat["operations"]))

path = "drivers/Loop/subscriber/sub-ctp-VetoSurname"
s, a = call("GET", "/api/artifact?path=" + path)
new = a["content"].replace("when the GCV says so", "when the GCV says so (smoke)")
req = {"args": {"path": path}, "files": {"content-file": new}, "revision": a["revision"]}
s, dry = call("POST", "/api/op/artifact.set-content", dict(req, dryRun=True))
check("dry run: passes, writes nothing, revision unchanged", s == 200 and dry["ok"] and not dry["written"] and dry["revision"] == a["revision"])
s, done = call("POST", "/api/op/artifact.set-content", dict(req, dryRun=False))
check("apply: written, revision moved", s == 200 and done["written"] and done["revision"] != a["revision"])
check("a stale revision is refused", call("POST", "/api/op/artifact.set-content", dict(req, dryRun=False))[0] == 409)
bad = dict(req, files={"content-file": new.replace("<do-veto/>", "<do-no-such-action/>")}, revision=done["revision"], dryRun=True)
s, refused = call("POST", "/api/op/artifact.set-content", bad)
check("a policy the engine rejects is refused by the compile check", s == 200 and not refused["ok"] and refused["newErrors"][0]["code"] == "compile-error")
check("an unknown operation is 404", call("POST", "/api/op/no.such", {"args": {}, "revision": done["revision"]})[0] == 404)
check("a missing argument is 400", call("POST", "/api/op/artifact.rename", {"args": {}, "revision": done["revision"]})[0] == 400)
print("smoke: all passed")
PY
