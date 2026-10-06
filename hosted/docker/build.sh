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
cp "$(ls -t "$HERE"/target/dirxml-dev-web-*.jar | grep -v page | head -1)" "$CTX/artifacts/dirxml-dev-web.jar"
cp "$(ls -t "$IDM_HOME"/target/dirxml-dev-*.jar | head -1)" "$CTX/artifacts/dirxml-dev.jar"
SIM_VER=${IDM_SIM_VERSION:-1.7.0}
cp "$HOME/.m2/repository/com/pointblue/dirxml/dirxml-simulator/$SIM_VER/dirxml-simulator-$SIM_VER.jar" "$CTX/artifacts/dirxml-simulator.jar"
cp -R "$HERE/web/dist" "$CTX/artifacts/dist"
cp -R "$IDM_HOME/bin/secrets" "$CTX/artifacts/secrets"
cp -R "$IDM_HOME/terraform" "$CTX/artifacts/terraform"
docker build ${PLATFORM:+--platform "$PLATFORM"} -t "$TAG" "$CTX"
echo "built $TAG"
