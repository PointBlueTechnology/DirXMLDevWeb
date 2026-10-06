#!/bin/sh
# Build the image for both architectures on a Docker host and push it to a registry that host trusts:
#   tar -C hosted/docker -czf - . | ssh user@host 'sh -s' < hosted/docker/push-on-host.sh -- REGISTRY/NAME:TAG [latest]
# or copy this script and the gathered context (hosted/docker after build.sh) to the host and run
#   push-on-host.sh CONTEXT_DIR REGISTRY/NAME:TAG [extra tags…]
# Why a host: a registry with a self-signed certificate valid longer than 825 days is refused by
# macOS (the buildx client checks it, not only the builder), so a Mac cannot push to such a
# Harbor; a Linux host that trusts the certificate can. The builder is a buildx docker-container
# builder told about the registry's certificate; arm64 on an x86 host needs binfmt (installed once).
set -e
CTX=${1:?context directory}
IMAGE=${2:?REGISTRY/NAME:TAG}
shift 2
REG=${IMAGE%%/*}
BUILDER=${BUILDER:-multi}
WORK=${WORK:-$HOME/.idmweb-build}
mkdir -p "$WORK"
if [ ! -f "$WORK/$REG.crt" ]; then
  openssl s_client -connect "$REG:443" -servername "$REG" </dev/null 2>/dev/null | openssl x509 -outform PEM > "$WORK/$REG.crt"
fi
printf '[registry."%s"]\n  ca=["%s"]\n' "$REG" "$WORK/$REG.crt" > "$WORK/buildkitd.toml"
docker buildx inspect "$BUILDER" >/dev/null 2>&1 || docker buildx create --name "$BUILDER" --driver docker-container --config "$WORK/buildkitd.toml" >/dev/null
docker run --privileged --rm tonistiigi/binfmt --install arm64 >/dev/null 2>&1 || true
TAGS="-t $IMAGE"
for t in "$@"; do TAGS="$TAGS -t ${IMAGE%:*}:$t"; done
# shellcheck disable=SC2086
docker buildx build --builder "$BUILDER" --platform "${PLATFORMS:-linux/amd64,linux/arm64}" $TAGS --push "$CTX"
echo "pushed $IMAGE $*"
