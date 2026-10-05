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
# an environment nothing listens on: the vault endpoints' gates are checked without a vault
cat > "$WORK/environments.properties" <<'ENV'
lab.url=ldaps://127.0.0.1:1
lab.bindDn=cn=nobody,o=none
lab.password=unused
lab.driverSet=cn=DriverSet,o=synth
lab.tier=dev
ENV
IDM_ENVIRONMENTS="$WORK/environments.properties" "$HERE/bin/idmweb" serve "$WORK/tree" --no-open > "$WORK/log" 2>&1 &
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

# W1: a batch is one change with real diffs; configuration and overrides as editors read them
names = {o["name"] for o in cat["operations"]}
s, cfg = call("GET", "/api/config?driver=Loop")
gcv = {g["name"]: g for g in cfg["gcvs"]}
check("config: GCVs in scope with where each is defined", gcv["drv.users"]["owner"] == "drivers/Loop" and gcv["synth.company"]["owner"] == "driverset" and gcv["drv.veto.surname"]["type"] == "boolean")
check("config: shim parameters and engine control values", cfg["params"][0]["name"] == "pub-heartbeat-interval" and cfg["ecvs"][0]["name"] == "dirxml.engine.retry-interval")
s, setcfg = call("GET", "/api/config")
check("config: the driver set's own GCVs", [g["name"] for g in setcfg["gcvs"]] == ["synth.company"])
rev = call("GET", "/api/session")[1]["revision"]
ops = [
    {"name": "gcv.set", "args": {"name": "drv.users", "value": "ou=people,o=synth", "driver": "Loop"}, "files": {}},
    {"name": "driver.set", "args": {"driver": "Loop", "key": "param:pub-heartbeat-interval", "value": "5"}, "files": {}},
    {"name": "filter.set-attr", "args": {"driver": "Loop", "class": "User", "attr": "Title", "publisher": "sync", "subscriber": "notify"}, "files": {}},
]
s, pre = call("POST", "/api/batch", {"ops": ops, "dryRun": True, "revision": rev})
files = {d["file"]: d for d in pre.get("diffs", [])}
check("batch preview: three changes, one verdict, each file before and after",
      s == 200 and pre["ok"] and not pre["written"] and set(files) == {"drivers/Loop/config-values.xml", "drivers/Loop/shim-config-info.xml", "drivers/Loop/driver-filter.xml"}
      and "ou=users,o=synth" in files["drivers/Loop/config-values.xml"]["before"] and "ou=people,o=synth" in files["drivers/Loop/config-values.xml"]["after"])
check("batch preview wrote nothing", call("GET", "/api/session")[1]["revision"] == rev)
s, app = call("POST", "/api/batch", {"ops": ops, "dryRun": False, "revision": rev})
check("batch apply: written together", s == 200 and app["written"] and len(app["changedFiles"]) == 3)
rev = app["revision"]
bad = ops[:1] + [{"name": "gcv.set", "args": {"name": "no.such.gcv", "value": "x", "driver": "Loop"}, "files": {}}]
bad[0] = {"name": "gcv.set", "args": {"name": "drv.users", "value": "ou=again,o=synth", "driver": "Loop"}, "files": {}}
s, ref = call("POST", "/api/batch", {"ops": bad, "dryRun": False, "revision": rev})
check("a batch with one refused member writes nothing and says which", s == 200 and not ref["ok"] and "change 2 of 2" in ref["refusal"] and call("GET", "/api/session")[1]["revision"] == rev)
if "override.set" in names:
    s, o = call("POST", "/api/batch", {"ops": [{"name": "override.set", "args": {"env": "prd", "key": "drivers/Loop.gcv.drv.users", "value": "ou=staff,o=corp"}, "files": {}}], "dryRun": False, "revision": rev})
    rev = o["revision"]
    s, ov = call("GET", "/api/overrides")
    row = ov["overrides"][0]
    check("overrides: the environment's value beside the base", o["ok"] and ov["environments"] == ["prd"] and row["values"] == {"prd": "ou=staff,o=corp"} and row["base"] == "ou=people,o=synth" and row["resolved"])
else:
    print("skip overrides: this DirXMLDev has no override.set")
if "config.set-content" in names:
    s, f = call("GET", "/api/file?file=drivers/Loop/driver-filter.xml")
    doc = f["content"].replace('subscriber="notify"', 'subscriber="reset"')
    s, c = call("POST", "/api/batch", {"ops": [{"name": "config.set-content", "args": {"kind": "driver-filter", "driver": "Loop"}, "files": {"content-file": doc}}], "dryRun": False, "revision": rev})
    check("a whole configuration document saves through config.set-content", s == 200 and c["written"] and c["changedFiles"] == ["drivers/Loop/driver-filter.xml"])
    s, c2 = call("POST", "/api/batch", {"ops": [{"name": "config.set-content", "args": {"kind": "driver-filter", "driver": "Loop"}, "files": {"content-file": "<configuration-values/>"}}], "dryRun": True, "revision": c["revision"]})
    check("and the wrong root is refused", not c2["ok"] and "<filter>" in c2["refusal"])
else:
    print("skip config.set-content: this DirXMLDev does not have it")
s, ve = call("GET", "/api/vault/environments")
check("vault: the environments, by name and tier, without their values", s == 200 and ve["available"] and ve["environments"] == [{"name": "lab", "tier": "dev", "ready": True, "hasOverrides": False}])
check("vault: an unknown environment is 400", call("GET", "/api/vault/diff?env=nope")[0] == 400)
s, dep = call("POST", "/api/vault/deploy", {"env": "lab"})
check("vault: a deploy without the typed environment name is refused before any connection", s == 200 and not dep["ok"] and "confirm" in dep["refusal"])
s, dep = call("POST", "/api/vault/deploy", {"env": "lab", "confirm": "prod"})
check("vault: and with another name", s == 200 and not dep["ok"] and "confirm" in dep["refusal"])
s, lc = call("POST", "/api/vault/driver", {"env": "lab", "driver": "Loop", "action": "start"})
check("vault: driver control without it is refused", s == 200 and not lc["ok"] and "confirm" in lc["text"])
check("vault: an unknown driver action is 400", call("POST", "/api/vault/driver", {"env": "lab", "driver": "Loop", "action": "explode", "confirm": "lab"})[0] == 400)
check("vault: the trace stream needs the token", call("GET", "/api/vault/trace?env=lab&driver=Loop", headers={"X-IDMWeb-Token": ""})[0] == 403)
print("smoke: all passed")
PY
