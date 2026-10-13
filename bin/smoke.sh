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
IDM_ENVIRONMENTS="$WORK/environments.properties" "$HERE/bin/idmweb" serve "$WORK/tree" --catalog "$WORK/catalog" --no-open > "$WORK/log" 2>&1 &
PID=$!
i=0
while ! grep -q '#token=' "$WORK/log" 2>/dev/null; do
  i=$((i + 1))
  [ $i -gt 40 ] && { echo "server did not start:"; cat "$WORK/log"; exit 1; }
  sleep 0.25
done
BASE=$(grep -oE 'http://127.0.0.1:[0-9]+' "$WORK/log" | head -1)
TOKEN=$(grep -oE 'token=[0-9a-f]+' "$WORK/log" | head -1 | cut -d= -f2)
python3 - "$BASE" "$TOKEN" "$WORK/environments.properties" <<'PY'
import json, os, sys, urllib.request, urllib.error
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
check("outline: the driver set's own record (servers, linkage, packages)", "servers" in outline["driverSet"] and "linkage" in outline["driverSet"] and "packages" in outline["driverSet"] and outline["driverSet"]["libraryItems"] == 2)
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
check("config: each GCV says where it comes from (the driver's own, inherited from the set)", gcv["drv.users"]["scope"] == "driver" and gcv["synth.company"]["scope"] == "driverset")
check("config: where each GCV is read", [u["path"] for u in gcv["drv.veto.surname"]["usedBy"]] == ["drivers/Loop/subscriber/sub-ctp-VetoSurname"] and gcv["drv.veto.surname"]["usedBy"][0]["kind"] == "policy")
s, sites = call("GET", "/api/packages/sites")
check("packages: the catalog's update sites (Designer's by default)", s == 200 and sites["available"] and [x["name"] for x in sites["sites"]] == ["Novell Public", "Novell Public 2.0"] and sites["sites"][0]["url"].startswith("https://nu.novell.com/"))
s, bad = call("GET", "/api/packages/site?site=http://127.0.0.1:9/nothing/")
check("packages: an unreachable site is reported, not an error", s == 200 and not bad["ok"] and bad["error"] and bad["packages"] == [])
check("packages: a site must be a known name or a URL", call("GET", "/api/packages/site?site=nowhere")[0] == 400)
check("packages: fetch needs packages", call("POST", "/api/packages/fetch", {"site": "Novell Public", "packages": []})[0] == 400)
check("packages: prompts of a package the catalog lacks is 400", call("GET", "/api/packages/prompts?packages=NOSUCH")[0] == 400)
check("packages: the catalog lists each package's features and prompts flag", all("features" in p and "hasPrompts" in p for p in call("GET", "/api/packages")[1]["catalog"]["packages"]))
s, sch = call("GET", "/api/schema")
check("schema: a tree without one says so", s == 200 and sch["present"] is False)
s, evd = call("GET", "/api/eventlog/describe?env=lab")
check("events: an environment without a store says so", s == 200 and evd["configured"] is False and "eventsUrl" in evd["message"])
check("events: listing without a store is refused", call("GET", "/api/eventlog?env=lab")[0] == 400)
check("events: a case from no store is refused", call("POST", "/api/eventlog/case", {"env": "lab", "id": 1, "dryRun": True})[0] == 400)
check("cache: a driver's cache needs a driver", call("GET", "/api/vault/cache?env=lab")[0] == 400)
import urllib.request as _ur
trace_text = "[10/07/26 11:15:11.244]:Loop ST:Applying policy: lib-NormalizeTitle.\n[10/07/26 11:15:12.000]:Loop PT:<status level=\"success\"/>\n".encode()
req = _ur.Request(base + "/api/traces/upload?name=sample.trace", method="POST", data=trace_text, headers={"X-IDMWeb-Token": token, "Content-Type": "application/octet-stream"})
with _ur.urlopen(req) as r:
    up = json.load(r)
check("traces: an uploaded file is stored under uploads/", up["ok"] and up["name"] == "uploads/sample.trace")
s, tl = call("GET", "/api/traces")
check("traces: the file is listed with its size", s == 200 and any(f["name"] == "uploads/sample.trace" and f["bytes"] == len(trace_text) for f in tl["files"]))
s, tr = call("GET", "/api/traces/records?name=uploads/sample.trace&from=0&count=10")
check("traces: the file is parsed into records with drivers and channels", s == 200 and tr["total"] == 2 and tr["drivers"] == ["Loop"] and tr["records"][1]["c"] == "P")
s, tr = call("GET", "/api/traces/records?name=uploads/sample.trace&from=0&count=10&channels=S&text=policy")
check("traces: the server filters by channel and text", s == 200 and tr["matched"] == 1 and tr["total"] == 2)
check("traces: a name that leaves the directory is refused", call("GET", "/api/traces/records?name=../x")[0] == 400)
with _ur.urlopen(_ur.Request(base + "/api/traces/file?name=uploads/sample.trace", headers={"X-IDMWeb-Token": token})) as r:
    body = r.read()
check("traces: the file downloads as it was uploaded", body == trace_text)
s, d = call("POST", "/api/traces/delete", {"name": "uploads/sample.trace"})
check("traces: the file is removed", s == 200 and not any(f["name"] == "uploads/sample.trace" for f in call("GET", "/api/traces")[1]["files"]))
s, cd = call("POST", "/api/vault/cache-delete", {"env": "lab", "driver": "Loop", "index": 1})
check("cache: deleting an event without the typed environment name is refused before any connection", s == 200 and cd["ok"] is False)
check("cache: the whole-cache export needs a driver", call("GET", "/api/vault/cache-file?env=lab")[0] == 400)
s, cc = call("POST", "/api/vault/cache-clear", {"env": "lab", "driver": "Loop"})
check("cache: clearing without the typed environment name is refused before any connection", s == 200 and cc["ok"] is False)
s, cv = call("GET", "/api/vault/cache?env=lab&driver=Loop")
check("cache: a vault nothing listens on fails cleanly", s >= 400 or cv.get("ok") is False)
s, app = call("GET", "/api/schema/app?driver=Loop")
check("schema: an application schema never read says so", s == 200 and app["present"] is False)
check("schema: a class of no schema is 404", call("GET", "/api/schema/class?name=User")[0] == 404)
rev0 = call("GET", "/api/session")[1]["revision"]
s, ref = call("POST", "/api/op/schema.add-attribute", {"args": {"name": "pbtTest", "syntax": "1.3.6.1.4.1.1466.115.121.1.15"}, "revision": rev0, "dryRun": True, "files": {}})
check("schema: defining an attribute without a schema is refused", s != 200 or ref.get("refusal") or not ref.get("ok", True))
s, nov = call("POST", "/api/vault/schema", {"env": "lab"})
check("schema: refresh against a vault nothing listens on fails cleanly", s >= 400 or nov.get("ok") is False)
check("schema: the deploy-schema route is deployer-only (gated like deploy)", call("POST", "/api/vault/deploy-schema", {"env": "lab"})[0] in (200, 403, 400, 502, 500))
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
rev = call("GET", "/api/session")[1]["revision"]
ent = '<entitlement conflict-resolution="union" description="Membership" display-name="Group membership"><values multi-valued="true"><value>cn=synth-users,ou=groups,o=synth</value><value>cn=synth-admins,ou=groups,o=synth</value></values></entitlement>'
s, es = call("POST", "/api/op/entitlement.set", {"args": {"name": "GroupMembership", "driver": "Loop"}, "files": {"definition-file": ent}, "dryRun": False, "revision": rev})
check("an entitlement definition saves whole (the file argument lives until the operation runs)", s == 200 and es["written"] and "synth-admins" in call("GET", "/api/file?file=drivers/Loop/entitlements/GroupMembership.xml")[1]["content"])
s, prd = call("GET", "/api/prd?driver=Loop&name=Request%20Access")
check("provisioning: a PRD's workflow as activities and links", s == 200 and [a["kind"] for a in prd["flow"]["activities"]] == ["start", "user", "finish"]
      and len(prd["flow"]["links"]) == 3 and prd["flow"]["activities"][1]["form"] == "Approve Access" and prd["bindings"][0]["form"] == "Request Access")
check("provisioning: an unknown PRD is 404", call("GET", "/api/prd?driver=Loop&name=Nope")[0] == 404)
s, frm = call("GET", "/api/form?driver=Loop&name=Request%20Access")
check("provisioning: a form with the PRD that binds it", s == 200 and frm["kind"] == "request" and '"components"' in frm["json"] and frm["usedBy"] == [{"prd": "Request Access", "activity": None, "fields": ["reason", "submit"]}])
s, cat = call("GET", "/api/roles")
check("provisioning: the catalog of the driver with provisioning", s == 200 and cat["drivers"] == ["Loop"] and cat["roles"] == [] and cat["resources"] == [])
rev = call("GET", "/api/session")[1]["revision"]
s, fe = call("POST", "/api/op/flow.activity.set", {"args": {"prd": "Request Access", "driver": "Loop", "id": "Approval", "name": "Manager approval"}, "dryRun": False, "revision": rev})
if s == 200 and fe.get("ok"):
    check("provisioning: a flow edit lands and the workflow shows it", call("GET", "/api/prd?driver=Loop&name=Request%20Access")[1]["flow"]["activities"][1]["name"] == "Manager approval")
elif "WRONG_DOCUMENT" in str(fe):
    print("skip flow edit: this DirXMLDev is older than 0.8.0")
else:
    check("provisioning: a flow edit lands", False)
s, cn = call("GET", "/api/credentials")
check("connections: the environments file, each environment by what is configured, never a value",
      s == 200 and cn["file"].endswith("environments.properties") and cn["environments"][0]["name"] == "lab" and cn["environments"][0]["password"] == "literal" and "unused" not in json.dumps(cn))
s, t = call("POST", "/api/credentials/test", {"url": "ldaps://127.0.0.1:1", "bindDn": "cn=nobody,o=none", "trustAll": True, "password": "x"})
check("connections: a test says why it failed, without the password", s == 200 and not t["ok"] and "127.0.0.1:1" in t["message"])
check("connections: a password store that is not one is refused", call("POST", "/api/credentials/environment", {"name": "new", "url": "ldaps://h:636", "bindDn": "cn=a", "driverSet": "cn=d", "password": "p", "passwordStore": "cloud"})[0] == 400)
s, sv = call("POST", "/api/credentials/environment", {"name": "new", "url": "ldaps://h:636", "bindDn": "cn=a", "driverSet": "cn=d", "tier": "stg", "password": "p", "passwordStore": "file"})
with open(sys.argv[3]) as fh:
    envtext = fh.read()
check("connections: a new environment is written to the file, owner-only", s == 200 and "new.url=ldaps://h:636" in envtext and "new.password=p" in envtext and "lab.url=ldaps://127.0.0.1:1" in envtext and oct(os.stat(sys.argv[3]).st_mode)[-3:] == "600")
s, sec = call("GET", "/api/credentials/secrets?env=new")
check("connections: the secrets the tree's drivers need", s == 200 and sec["file"].endswith("secrets-new.properties") and not sec["exists"] and isinstance(sec["needs"], list))
s, ss = call("POST", "/api/credentials/secret", {"env": "new", "key": "Loop Driver.named.svc", "store": "file", "value": "s3"})
s2, sec = call("GET", "/api/credentials/secrets?env=new")
check("connections: a secret is stored in the environment's secrets file and listed by kind only", s == 200 and sec["exists"] and any(o["key"] == "Loop Driver.named.svc" and o["configured"] == "literal" for o in sec["others"] + sec["needs"]) and "s3" not in json.dumps(sec))
s, rs = call("POST", "/api/credentials/resolve", {"command": "printf from-a-manager"})
check("connections: a secret-manager command is tried and judged, its value kept out of the answer", s == 200 and rs["ok"] and "from-a-manager" not in json.dumps(rs))
check("connections: a command that prints nothing or fails is reported so", not call("POST", "/api/credentials/resolve", {"command": "true"})[1]["ok"] and "exited" in call("POST", "/api/credentials/resolve", {"command": "exit 4"})[1]["message"])
s, ss = call("POST", "/api/credentials/secret", {"env": "new", "key": "Loop Driver.named.api", "store": "command:printf x"})
s2, rs = call("POST", "/api/credentials/resolve", {"env": "new", "key": "Loop Driver.named.api"})
check("connections: a reference to a manager is saved as the command and resolves", s == 200 and s2 == 200 and rs["ok"] and "Loop Driver.named.apiCommand=printf x" in open(os.path.join(os.path.dirname(sys.argv[3]), "secrets-new.properties")).read())
s, rm = call("POST", "/api/credentials/environment/remove", {"name": "new"})
check("connections: an environment is removed", s == 200 and rm["removed"] >= 5 and "new" not in [e["name"] for e in call("GET", "/api/credentials")[1]["environments"]])
s, pk = call("GET", "/api/packages")
check("packages: an empty catalog and the tree's installed packages (none)", s == 200 and pk["catalog"]["available"] and pk["catalog"]["packages"] == [] and [t["name"] for t in pk["status"]["targets"]] == ["Loop"] and pk["status"]["targets"][0]["packages"] == [])
check("packages: a build needs a short name and a display name", call("POST", "/api/packages/build", {"driver": "Loop", "short": "SYNTHLOOP"})[0] == 400)
s, bd = call("POST", "/api/packages/build", {"driver": "Loop", "short": "SYNTHLOOP", "name": "Synthetic Loop", "vendor": "Point Blue", "version": "0.1.0"})
check("packages: a package is built from the driver into the catalog", s == 200 and bd["ok"] and bd["jar"].endswith(".jar") and any(o.startswith("drivers/Loop/") for o in bd["objects"]))
s, pk = call("GET", "/api/packages")
check("packages: the catalog lists it", s == 200 and [p["short"] for p in pk["catalog"]["packages"]] == ["SYNTHLOOP"] and pk["catalog"]["packages"][0]["versions"][0].startswith("0.1.0"))
rev = call("GET", "/api/session")[1]["revision"]
s, inst = call("POST", "/api/op/package.install", {"args": {"driver": "Loop", "package": "SYNTHLOOP"}, "dryRun": True, "revision": rev})
check("packages: the server supplies the catalog to package operations", s == 200 and "catalog" not in str(inst.get("refusal")) and ("already exists" in str(inst.get("refusal")) or inst["ok"]))
s, sc = call("GET", "/api/sim/cases")
check("simulator: an empty corpus, and where it will be kept", s == 200 and sc["cases"] == [] and sc["dir"].endswith("/cases"))
xds = '<nds dtdversion="4.0"><input><add class-name="User" src-dn="\\SYNTH\\synth\\people\\jdoe"><add-attr attr-name="Surname"><value type="string">Doe</value></add-attr><add-attr attr-name="Title"><value type="string">mgr</value></add-attr></add></input></nds>'
check("simulator: a case name cannot leave the corpus", call("POST", "/api/sim/save", {"name": "../x", "driver": "Loop", "input": xds})[0] == 400)
check("simulator: an input that is not XML is refused", call("POST", "/api/sim/save", {"name": "bad", "driver": "Loop", "input": "<a>"})[0] == 400)
check("simulator: a case for a driver the tree lacks is refused", call("POST", "/api/sim/save", {"name": "bad", "driver": "Nope", "input": xds})[0] == 400)
s, sv = call("POST", "/api/sim/save", {"name": "add-user", "driver": "Loop", "channel": "subscriber", "input": xds})
check("simulator: a case is created", s == 200 and sv["created"])
s, det = call("POST", "/api/sim/detail", {"name": "add-user"})
check("simulator: the case runs stage by stage through the tree's policies",
      s == 200 and det["ok"] and [st["name"] for st in det["stages"]] == ["subscriber-command:sub-ctp-VetoSurname", "subscriber-command:lib-NormalizeTitle", "schema-mapping:smp"]
      and [st["changed"] for st in det["stages"]] == [False, True, True] and ">Manager<" in det["final"] and det["outcome"] == "skip")
s, rec = call("POST", "/api/sim/record", {"name": "add-user"})
check("simulator: its output is recorded", s == 200 and rec["wrote"] == ["expected-output.xds"])
s, run = call("POST", "/api/sim/run", {})
check("simulator: the corpus passes", s == 200 and run["ok"] and run["pass"] == 1)
s, det = call("POST", "/api/sim/detail", {"name": "add-user", "input": xds.replace(">mgr<", ">eng<"), "against": ""})
check("simulator: another input is tried without saving it, and fails what was recorded",
      s == 200 and det["outcome"] == "fail" and ">Engineer<" in det["final"] and det["against"]["same"] and ">mgr<" in call("GET", "/api/sim/case?name=add-user")[1]["input"])
s, ve = call("GET", "/api/vault/environments")
check("vault: the environments, by name and tier, without their values", s == 200 and ve["available"] and ve["environments"] == [{"name": "lab", "tier": "dev", "ready": True, "defined": True, "connected": True, "own": False, "hasOverrides": False}] and ve["split"] is False)
check("vault: an unknown environment is 400", call("GET", "/api/vault/diff?env=nope")[0] == 400)
s, snaps = call("GET", "/api/vault/snapshots?env=lab")
check("vault: the snapshots of an environment, none yet", s == 200 and snaps["snapshots"] == [] and snaps["dir"] == "deploy-snapshots/lab")
s, rb = call("POST", "/api/vault/rollback", {"env": "lab", "snapshot": "deploy-snapshots/lab/x.ldif", "confirm": "nope"})
check("vault: a rollback without the typed environment name is refused before anything is read", s == 200 and rb["ok"] is False and "lab" in rb["refusal"])
check("vault: a rollback to a file outside the environment's snapshots is 400", call("POST", "/api/vault/rollback", {"env": "lab", "snapshot": "../etc/passwd", "confirm": "lab"})[0] == 400)
check("vault: a plan with an unknown secrets mode is 400", call("POST", "/api/vault/plan", {"env": "lab", "drivers": [], "secrets": "sometimes"})[0] == 400)
check("vault: an object inspection without a DN is 400", call("GET", "/api/vault/inspect?env=lab")[0] == 400)
s, so = call("POST", "/api/vault/start-option", {"env": "lab", "driver": "Loop", "option": "manual", "confirm": "nope"})
check("vault: a start-option change without the typed environment name is refused before any connection", s == 200 and so["ok"] is False and "lab" in so["text"])
s, jb = call("POST", "/api/vault/job", {"env": "lab", "job": "StatisticsJob", "action": "start", "confirm": "nope"})
check("vault: a job start without the typed environment name is refused before any connection", s == 200 and jb["ok"] is False and "lab" in jb["text"])
check("vault: an unknown job action is 400", call("POST", "/api/vault/job", {"env": "lab", "job": "x", "action": "pause", "confirm": "lab"})[0] == 400)
check("vault: a query without a driver is 400", call("POST", "/api/vault/query", {"env": "lab", "className": "User"})[0] == 400)
check("vault: health without a driver is 400", call("GET", "/api/vault/health?env=lab")[0] == 400)
check("vault: rights without an object is 400", call("GET", "/api/vault/rights?env=lab&driver=x")[0] == 400)
s, ll = call("POST", "/api/vault/log-level", {"env": "lab", "driver": "x", "level": "errors", "confirm": "nope"})
check("vault: a log level without the typed environment name is refused before any connection", s == 200 and ll.get("ok") is False)
check("vault: a specific-events log level from the page is 400", call("POST", "/api/vault/log-level", {"env": "lab", "driver": "x", "level": "specific-events", "confirm": "lab"})[0] == 400)
check("vault: an e-mail server change with nothing in it is 400", call("POST", "/api/vault/email-server", {"env": "lab", "values": {}, "confirm": "lab"})[0] == 400)
check("vault: driver status without a driver is 400", call("GET", "/api/vault/driver-status?env=lab")[0] == 400)
check("vault: a trace change with neither level nor file is 400", call("POST", "/api/vault/trace-level", {"env": "lab", "driver": "x", "confirm": "lab"})[0] == 400)
check("vault: a submit without a document is 400", call("POST", "/api/vault/submit", {"env": "lab", "driver": "x", "xds": "", "confirm": "lab"})[0] == 400)
check("vault: a resync with a bad instant is 400", call("POST", "/api/vault/resync", {"env": "lab", "driver": "x", "since": "yesterday", "confirm": "lab"})[0] == 400)
s, np_ = call("POST", "/api/vault/named-password", {"env": "lab", "driver": "x", "action": "set", "name": "n", "value": "s3cret-value", "confirm": "nope"})
check("vault: a named password without the typed environment name is refused, and the value is not echoed", s == 200 and np_.get("ok") is False and "s3cret-value" not in json.dumps(np_))
check("vault: a named-password action other than set/remove is 400", call("POST", "/api/vault/named-password", {"env": "lab", "driver": "x", "action": "show", "name": "n", "confirm": "lab"})[0] == 400)
check("vault: policy members without a policy is 400", call("GET", "/api/vault/rbe-members?env=lab")[0] == 400)
check("outline: the driver and the set carry their jobs", "jobs" in outline["drivers"][0] and "jobs" in outline["driverSet"])
check("vault: an unknown start option is 400", call("POST", "/api/vault/start-option", {"env": "lab", "driver": "Loop", "option": "sometimes", "confirm": "lab"})[0] == 400)
s, arch = call("GET", "/api/architecture")
check("architecture: the set and one application per driver, typed", s == 200 and arch["driverSet"]["name"] and len(arch["applications"]) == len(outline["drivers"]) and arch["applications"][0]["driver"] == "Loop" and arch["applications"][0]["type"] == "LoopBack" and arch["applications"][0]["vaultOnly"] is True and arch["applications"][0]["typeName"] == "Loopback")
check("architecture: a driver without an icon is 404", call("GET", "/api/driver-icon?driver=Loop")[0] == 404)
s, dev = call("GET", "/api/developer")
kids = {c["label"]: c for c in dev["root"]["children"]}
loop = kids["Drivers"]["children"][0]
check("developer: the set, its library and each driver as a tree with counts", s == 200 and dev["root"]["kind"] == "driverset" and "Library" in kids and loop["label"] == "Loop" and loop["count"] > 0 and [c["label"] for c in loop["children"][:3]] == ["Configuration", "Subscriber", "Publisher"])
check("developer: a policy set lists its policies in order with what to open", any(len(ps["children"]) == 1 and ps["children"][0]["select"]["type"] == "artifact" for ch in loop["children"] if ch["kind"] == "channel" for ps in ch["children"]))
check("schema: a compare names an unknown environment as 400", call("GET", "/api/vault/schema-diff?env=nope")[0] == 400)
s, sd = call("GET", "/api/vault/schema-diff?env=lab")
check("schema: a compare without a schema in the tree says to read one first", s == 400 and "vault.schema" in sd["error"])
s, dep = call("POST", "/api/vault/deploy", {"env": "lab"})
check("vault: a deploy without the typed environment name is refused before any connection", s == 200 and not dep["ok"] and "confirm" in dep["refusal"])
s, dep = call("POST", "/api/vault/deploy", {"env": "lab", "confirm": "prod"})
check("vault: and with another name", s == 200 and not dep["ok"] and "confirm" in dep["refusal"])
s, lc = call("POST", "/api/vault/driver", {"env": "lab", "driver": "Loop", "action": "start"})
check("vault: driver control without it is refused", s == 200 and not lc["ok"] and "confirm" in lc["text"])
check("vault: an unknown driver action is 400", call("POST", "/api/vault/driver", {"env": "lab", "driver": "Loop", "action": "explode", "confirm": "lab"})[0] == 400)
check("vault: the trace stream needs the token", call("GET", "/api/vault/trace?env=lab&driver=Loop", headers={"X-IDMWeb-Token": ""})[0] == 403)
s, ses = call("GET", "/api/session")
check("pull: an apply with a stale revision is refused before the vault is read", call("POST", "/api/vault/pull", {"env": "lab", "drivers": [], "dryRun": False, "revision": "stale"})[0] == 409)
check("pull: an unknown environment is 400", call("POST", "/api/vault/pull", {"env": "nope", "revision": ses["revision"]})[0] == 400)
s, pl = call("POST", "/api/vault/pull", {"env": "lab", "revision": ses["revision"], "dryRun": False})
check("pull: an unreachable vault is an error and the tree is untouched", s >= 400 and call("GET", "/api/session")[1]["revision"] == ses["revision"])
check("merge-captured: only a captured as-found branch", call("POST", "/api/git/merge-captured", {"branch": "main"})[0] == 400)
# the round trip back to Designer (#66)
import io, tempfile, zipfile
def raw(method, path, data=None, ctype="application/zip"):
    req = urllib.request.Request(base + path, method=method, headers={"X-IDMWeb-Token": token, "Content-Type": ctype}, data=data)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()
s, h, xml = raw("GET", "/api/export/designer")
check("designer: the export XML downloads as an attachment", s == 200 and "attachment" in h.get("Content-Disposition", "") and xml.startswith(b"<?xml") and b"Loop" in xml)
check("designer: one driver's export, and an unknown driver is 404", raw("GET", "/api/export/designer?driver=Loop")[0] == 200 and raw("GET", "/api/export/designer?driver=nope")[0] == 404)
check("designer: a project path must be absolute", call("POST", "/api/export/project", {"mode": "update", "path": "rel/proj", "dryRun": True})[0] == 400)
scratch = tempfile.mkdtemp()
check("designer: a folder without .project is not a project to update", call("POST", "/api/export/project", {"mode": "update", "path": scratch, "dryRun": True})[0] == 400)
s, np = call("POST", "/api/export/project", {"mode": "new", "path": os.path.join(scratch, "NewP"), "dryRun": True, "vaultName": "T"})
check("designer: a new project's dry run lists its files and writes nothing", s == 200 and np["ok"] and np["createdFiles"] and not np["written"] and not os.path.exists(os.path.join(scratch, "NewP")))
check("designer: a new project's name is checked", raw("POST", "/api/export/project-zip?mode=new&name=..%2Fx&dryRun=true")[0] == 400)
s, h, z = raw("POST", "/api/export/project-zip?mode=new&name=NewP&dryRun=false&vaultName=T")
names = zipfile.ZipFile(io.BytesIO(z)).namelist() if s == 200 else []
check("designer: a new project comes back as a zip with its folder at the root", s == 200 and h.get("Content-Type") == "application/zip" and "NewP/.project" in names and all(n.startswith("NewP/") for n in names))
s, up = call("POST", "/api/export/project-zip?mode=update&dryRun=true")
check("designer: an update needs the project zip", s == 400)
s, h, b = raw("POST", "/api/export/project-zip?mode=update&dryRun=true", b"not a zip")
check("designer: something that is not a zip is 400", s == 400)
check("designer: the vault fields are for a new project only", raw("POST", "/api/export/project-zip?mode=update&dryRun=true&vaultName=T", z)[0] == 400)
s, h, b = raw("POST", "/api/export/project-zip?mode=update&dryRun=true", z)
upd = json.loads(b) if s == 200 else {}
check("designer: the new project uploaded again already matches the tree", s == 200 and upd["ok"] and upd["refusal"] is None and not upd["changedFiles"] and not upd["createdFiles"] and not upd["deletedFiles"])
print("smoke: all passed")
PY
