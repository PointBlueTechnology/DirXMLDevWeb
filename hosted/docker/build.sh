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
cp -R "$IDM_HOME/bin/secrets" "$CTX/artifacts/secrets"
cp -R "$IDM_HOME/terraform" "$CTX/artifacts/terraform"
find "$CTX/artifacts/terraform" -name .terraform -prune -exec rm -rf {} + 2>/dev/null || true
find "$CTX/artifacts/terraform" \( -name '*.tfstate*' -o -name '.terraform.lock.hcl' \) -delete 2>/dev/null || true
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
