#!/bin/sh
# Build the hosted image from the two checkouts: hosted/docker/build.sh [tag]
# Gathers the server jar, the page, DirXMLDev's jar and the simulator jar (all already built —
# run `mvn -o package` and `npm run build` here, `mvn -o install` in DirXMLDev first), the
# secret-manager helpers and the Terraform module, then `docker build`. No engine jar is copied.
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
cp -R "$HERE/web/dist" "$CTX/artifacts/dist"
cp -R "$IDM_HOME/bin/secrets" "$CTX/artifacts/secrets"
cp -R "$IDM_HOME/terraform" "$CTX/artifacts/terraform"
find "$CTX/artifacts/terraform" -name .terraform -prune -exec rm -rf {} + 2>/dev/null || true
find "$CTX/artifacts/terraform" \( -name '*.tfstate*' -o -name '.terraform.lock.hcl' \) -delete 2>/dev/null || true
docker build ${PLATFORM:+--platform "$PLATFORM"} -t "$TAG" "$CTX"
echo "built $TAG"
