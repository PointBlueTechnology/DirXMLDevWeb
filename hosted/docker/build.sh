#!/bin/sh
# Build the hosted image from the two checkouts:
#   hosted/docker/build.sh [image[:tag]]            local image for this machine (docker build)
#   PUSH=1 hosted/docker/build.sh REGISTRY/NAME:TAG  multi-arch (amd64+arm64) with buildx, pushed to the registry
# Gathers the server jar, the page, DirXMLDev's jar and the simulator jar (all already built —
# run `mvn -o package` and `npm run build` here, `mvn -o package` in DirXMLDev first), the
# secret-manager helpers and the Terraform module, then builds. No engine jar is copied — the
# context is checked for one before any build, so a published image can never carry NetIQ's jars.
#   PLATFORMS   platforms for PUSH=1 (default linux/amd64,linux/arm64)
#   PLATFORM    one platform for a local build (e.g. linux/amd64 for an x86 host from a Mac)
#   ALSO_TAG    extra tags to push, space-separated (e.g. "latest")
set -e
HERE=$(cd "$(dirname "$0")/../.." && pwd)
IDM_HOME=${IDM_HOME:-"$HERE/../DirXMLDev"}
TAG=${1:-dirxml-dev-web:latest}
CTX="$HERE/hosted/docker"
rm -rf "$CTX/artifacts" && mkdir -p "$CTX/artifacts"
# the jars the poms name, not the newest files in target/ (a rebuild of an older version would win)
WEB_VER=$(sed -n 's#.*<version>\([^<]*\)</version>.*#\1#p' "$HERE/pom.xml" | head -1)
CORE_VER=$(sed -n 's#.*<dirxmldev.version>\([^<]*\)</dirxmldev.version>.*#\1#p' "$HERE/pom.xml" | head -1)
cp "$HERE/target/dirxml-dev-web-$WEB_VER.jar" "$CTX/artifacts/dirxml-dev-web.jar"
if [ -f "$IDM_HOME/target/dirxml-dev-$CORE_VER.jar" ]; then
  cp "$IDM_HOME/target/dirxml-dev-$CORE_VER.jar" "$CTX/artifacts/dirxml-dev.jar"
else
  cp "$HOME/.m2/repository/com/pointblue/dirxml/dirxml-dev/$CORE_VER/dirxml-dev-$CORE_VER.jar" "$CTX/artifacts/dirxml-dev.jar"
fi
echo "web $WEB_VER, core $CORE_VER"
SIM_VER=${IDM_SIM_VERSION:-1.7.0}
cp "$HOME/.m2/repository/com/pointblue/dirxml/dirxml-simulator/$SIM_VER/dirxml-simulator-$SIM_VER.jar" "$CTX/artifacts/dirxml-simulator.jar"
TRACE_VER=$(sed -n 's#.*<tracecore.version>\([^<]*\)</tracecore.version>.*#\1#p' "$HERE/pom.xml" | head -1)
cp "$HOME/.m2/repository/com/pointbluetech/dirxml-trace-core/$TRACE_VER/dirxml-trace-core-$TRACE_VER.jar" "$CTX/artifacts/dirxml-trace-core.jar"
PG_VER=$(sed -n 's#.*<postgresql.version>\([^<]*\)</postgresql.version>.*#\1#p' "$HERE/pom.xml" | head -1)
cp "$HOME/.m2/repository/org/postgresql/postgresql/$PG_VER/postgresql-$PG_VER.jar" "$CTX/artifacts/postgresql.jar"
# the vault path's LDAP client: open-source JLDAP (OpenLDAP Public License), attached to the core's release
cp "$HOME/.m2/repository/com/novell/ldap/jldap/4.3/jldap-4.3.jar" "$CTX/artifacts/jldap.jar"
AUTH_VER=$(sed -n 's#.*<console.version>\([^<]*\)</console.version>.*#\1#p' "$HERE/pom.xml" | head -1)
cp "$HOME/.m2/repository/com/pointblue/console/console-auth/$AUTH_VER/console-auth-$AUTH_VER.jar" "$CTX/artifacts/console-auth.jar"
cp -R "$HERE/web/dist" "$CTX/artifacts/dist"
# the notices and the license go into the image, as the components' licenses ask of a redistribution
cp "$HERE/THIRD-PARTY.md" "$HERE/LICENSE" "$CTX/artifacts/"
cp -R "$IDM_HOME/bin/secrets" "$CTX/artifacts/secrets"
cp -R "$IDM_HOME/terraform" "$CTX/artifacts/terraform"
find "$CTX/artifacts/terraform" -name .terraform -prune -exec rm -rf {} + 2>/dev/null || true
find "$CTX/artifacts/terraform" \( -name '*.tfstate*' -o -name '.terraform.lock.hcl' \) -delete 2>/dev/null || true
# bin/apps (the Identity Applications helper), behind the image's apps launcher
cp "$IDM_HOME/bin/apps" "$CTX/artifacts/apps.py"
# the agent kit (docs/agents.md): this version's rules, skills and docs for an agent working with the server
SIM_HOME=${SIM_HOME:-"$HERE/../DirXMLSimulator"}
KIT="$CTX/artifacts/agent-kit"
mkdir -p "$KIT/.claude/skills" "$KIT/docs"
cp "$HERE/hosted/agent-kit/AGENTS.md" "$HERE/hosted/agent-kit/CLAUDE.md" "$KIT/"
cp -R "$IDM_HOME/.claude/skills/dirxml-dev" "$KIT/.claude/skills/"
if [ -d "$SIM_HOME/.claude/skills/dirxml-policy-testing" ]; then
  cp -R "$SIM_HOME/.claude/skills/dirxml-policy-testing" "$KIT/.claude/skills/"
else
  echo "note: no DirXMLSimulator checkout at $SIM_HOME: the agent kit has no simulator skill" >&2
fi
cp "$IDM_HOME/docs/agent-guide.md" "$KIT/docs/"
cp "$HERE/docs/agents.md" "$HERE/docs/environment-practices.md" "$HERE/docs/git-workflow.md" "$KIT/docs/"
# each skill says, under its front matter, where its commands are in this install
for s in "$KIT"/.claude/skills/*/SKILL.md; do
  python3 - "$s" <<'PY'
import sys
p = sys.argv[1]
t = open(p, encoding="utf-8").read()
note = ("\n> **In a DirXMLDevWeb install:** on the machine that runs the container, `bin/idm` is `docker exec idmweb idm`, "
        "`bin/sim` is `docker exec idmweb sim` and `bin/apps` is `docker exec idmweb apps`, run in your workspace; "
        "or use the `dirxmldev` MCP tools. The kit's AGENTS.md has the rules and how to connect.\n")
if t.startswith("---"):
    end = t.index("\n---", 3) + 4
    t = t[:end] + "\n" + note + t[end:]
else:
    t = note + "\n" + t
open(p, "w", encoding="utf-8").write(t)
PY
done
# the engine's jars are NetIQ's: refuse to build if any reached the context (a class from one would be
# com/novell/nds/dirxml/… or com/netiq/…; DirXMLDev's own jar is com/pointblue/…)
for j in "$CTX"/artifacts/*.jar; do
  case "$(basename "$j")" in dirxml-dev.jar|dirxml-dev-web.jar|dirxml-simulator.jar|dirxml-trace-core.jar|postgresql.jar|console-auth.jar|jldap.jar) ;; *) echo "ERROR: unexpected jar in the image context: $j" >&2; exit 1;; esac
  if unzip -l "$j" | grep -qE ' com/novell/nds/dirxml/engine/| com/netiq/nds/| com/novell/nds/dirxml/driver/[a-z]+/[A-Z]'; then
    echo "ERROR: $j carries engine or driver classes — not publishable" >&2; exit 1
  fi
done
if [ -n "$PUSH" ]; then
  TAGS="-t $TAG"
  for t in ${ALSO_TAG:-}; do TAGS="$TAGS -t ${TAG%:*}:$t"; done
  # shellcheck disable=SC2086
  docker buildx build --platform "${PLATFORMS:-linux/amd64,linux/arm64}" $TAGS --push "$CTX"
  echo "pushed $TAG${ALSO_TAG:+ (+ $ALSO_TAG)}"
else
  docker build ${PLATFORM:+--platform "$PLATFORM"} -t "$TAG" "$CTX"
  echo "built $TAG"
fi
