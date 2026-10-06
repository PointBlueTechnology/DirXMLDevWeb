#!/bin/sh
# One person, one container, one command:
#   hosted/docker/single-user/setup.sh <tree> [<dir>]
# Makes <dir> (default ~/idmweb): a bare repository holding your tree, the engine jars (from
# DirXMLDev's lib/ beside this checkout, or $IDM_LIB), one access token, the configuration,
# and starts the container. Prints the URL and where the token is. Re-running on an existing
# <dir> keeps its repository, token and configuration and just (re)starts the container.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
TREE=${1:?usage: setup.sh <tree> [<dir>]}
TREE=$(cd "$TREE" && pwd)
DIR=${2:-$HOME/idmweb}
IMAGE=${IDMWEB_IMAGE:-dirxml-dev-web:latest}
PORT=${IDMWEB_PORT:-8080}
[ -f "$TREE/driverset.xml" ] || { echo "ERROR: $TREE is not an IDM-as-code tree (no driverset.xml)" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker is not running" >&2; exit 1; }
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "building $IMAGE from the checkouts…"
  "$ROOT/hosted/docker/build.sh" "$IMAGE" >/dev/null
fi
mkdir -p "$DIR" && cd "$DIR"
cp "$HERE/compose.yml" compose.yml
mkdir -p config data lib
[ -f config/hosted.properties ] || cp "$HERE/config/hosted.properties" config/hosted.properties
# the engine jars: never in the image; $DIR/lib is the volume the container reads them from
if [ -z "$(ls lib/*.jar 2>/dev/null)" ]; then
  SRC=${IDM_LIB:-$ROOT/../DirXMLDev/lib}
  if [ -n "$(ls "$SRC"/*.jar 2>/dev/null)" ]; then
    cp -L "$SRC"/*.jar lib/ && echo "engine jars: $(ls lib | wc -l | tr -d ' ') copied from $SRC into $DIR/lib"
  else
    echo "NOTE: put the engine jars in $DIR/lib (or run again with IDM_LIB=/path/to/them): dirxml.jar, dirxml_misc.jar, nxsl.jar, xp.jar, CommonDriverShim.jar, jclient.jar, dhutil.jar, XDS.jar, js.jar, ldap.jar — from an IDM engine's lib/dirxml/classes (copy the files, not symlinks). Without them the page runs, but the compile check, the simulator and vault access do not." >&2
  fi
fi
# the repository: your tree under tree/, the corpus under cases/
if [ ! -d repo.git ]; then
  rm -rf seed && mkdir -p seed/cases
  cp -R "$TREE" seed/tree
  [ -d "$TREE/../cases" ] && cp -R "$TREE/../cases/." seed/cases/
  printf 'deploy-snapshots/\n.dirxmldev/\n' > seed/.gitignore
  git -C seed init -q -b main
  git -C seed -c user.name="${USER:-me}" -c user.email="${USER:-me}@localhost" add -A
  git -C seed -c user.name="${USER:-me}" -c user.email="${USER:-me}@localhost" commit -q -m "initial tree from $TREE"
  git init -q --bare -b main repo.git
  git -C seed push -q "$DIR/repo.git" main
  rm -rf seed
  echo "repository: $DIR/repo.git (main holds tree/ and cases/)"
fi
# the tokens: yours for the page, one for an agent
[ -f idmweb.env ] || : > idmweb.env
chmod 600 idmweb.env
grep -q '^IDMWEB_TOKEN=' idmweb.env || printf 'IDMWEB_TOKEN=%s\n' "$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-32)" >> idmweb.env
grep -q '^IDMWEB_AGENT_TOKEN=' idmweb.env || printf 'IDMWEB_AGENT_TOKEN=%s\n' "$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-32)" >> idmweb.env
# the environments file: yours if you have one, else empty (the page's Connections view fills it)
if [ ! -f config/environments.properties ]; then
  if [ -n "$IDM_ENVIRONMENTS" ] && [ -f "$IDM_ENVIRONMENTS" ]; then
    cp "$IDM_ENVIRONMENTS" config/environments.properties && echo "environments: copied from $IDM_ENVIRONMENTS (passwords in it are read by the container; Keychain references will not resolve there)"
  else
    : > config/environments.properties
  fi
fi
chmod 600 config/*.properties
sed -i.bak "s/^token.user=.*/token.user=${USER:-me}/; s#^public.url=.*#public.url=http://localhost:$PORT#" config/hosted.properties && rm -f config/hosted.properties.bak
cat > .env <<ENV
IDMWEB_IMAGE=$IMAGE
IDMWEB_PORT=$PORT
IDMWEB_UID=$(id -u)
IDMWEB_GID=$(id -g)
ENV
# the CLI and the simulator, inside the container, in the workspace of a branch (main by default)
cat > idm <<'SH'
#!/bin/sh
# idm inside the container, run in the workspace of $IDMWEB_BRANCH (default main):  ./idm validate tree
cd "$(dirname "$0")"
B=${IDMWEB_BRANCH:-main}
U=$(grep '^token.user=' config/hosted.properties | cut -d= -f2)
W="/var/lib/idmweb/workspaces/$U/$(printf '%s' "$B" | sed 's#[^A-Za-z0-9._-]#_#g')"
exec docker compose exec -T -w "$W" idmweb idm "$@"
SH
chmod +x idm
docker compose up -d >/dev/null
i=0
until curl -s "http://localhost:$PORT/api/session" >/dev/null 2>&1; do i=$((i + 1)); [ $i -gt 40 ] && { docker compose logs idmweb | tail -5; exit 1; }; sleep 0.5; done
echo
echo "DirXMLDevWeb is at http://localhost:$PORT"
echo "  sign in with the token in $DIR/idmweb.env   (cat $DIR/idmweb.env)"
echo "  open a branch (main) on the page; it is cloned under $DIR/data/workspaces/"
echo "  the CLI and the simulator in that workspace:  $DIR/idm validate tree    $DIR/idm simulate tree --cases cases"
echo "  vault connections: the page's Connections view, or $DIR/config/environments.properties"
echo "  an agent on this machine: the CLI above, or the API with  Authorization: Bearer \$IDMWEB_AGENT_TOKEN  (second line of idmweb.env)"
echo "  engine jars: $DIR/lib (a volume; the image never holds them)"
echo "  stop: (cd $DIR && docker compose down)"
