#!/bin/sh
# One person, one container, one command:
#   setup.sh <tree> [<dir>]      start with an IDM-as-code tree you already have
#   setup.sh - [<dir>]           start with nothing: the page asks where the tree comes from
#                                (export from a vault, a Designer project or export, a repository, a remote)
# Makes <dir> (default ~/idmweb): the engine jars (from $IDM_LIB, or DirXMLDev's lib/ beside a
# checkout), a bare repository holding your tree when you gave one, one access token, the
# configuration, and starts the container. Prints the URL and where the token is. Re-running on
# an existing <dir> keeps its repository, token and configuration and just (re)starts the
# container (a new IDMWEB_IMAGE is picked up).
#   IDMWEB_IMAGE   the image: a registry name is pulled (ghcr.io/pointbluetechnology/dirxml-dev-web:latest, or
#                  :<version> to stay on one release); a bare name is built from the checkouts
#   IDMWEB_PORT    the page's port on localhost (default 8080)
#   IDM_LIB        where the engine jars are
#   CONTAINER      docker (default) or podman; COMPOSE overrides the compose command ("podman compose",
#                  "podman-compose", "docker compose"). Rootless Podman keeps your uid inside the
#                  container through compose.podman.yml (userns keep-id), so files stay yours.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ARG=${1:?usage: setup.sh <tree>|- [<dir>]}
TREE=
if [ "$ARG" != "-" ]; then
  TREE=$(cd "$ARG" && pwd)
  [ -f "$TREE/driverset.xml" ] || { echo "ERROR: $TREE is not an IDM-as-code tree (no driverset.xml); pass - to start without one" >&2; exit 1; }
fi
DIR=${2:-$HOME/idmweb}
IMAGE=${IDMWEB_IMAGE:-dirxml-dev-web:latest}
PORT=${IDMWEB_PORT:-8080}
CONTAINER=${CONTAINER:-docker}
if [ -z "${COMPOSE:-}" ]; then
  if [ "$CONTAINER" = podman ]; then
    if podman compose version >/dev/null 2>&1; then COMPOSE="podman compose"; else COMPOSE="podman-compose"; fi
  else
    COMPOSE="docker compose"
  fi
fi
COMPOSE_FILES="-f compose.yml"
[ "$CONTAINER" = podman ] && COMPOSE_FILES="-f compose.yml -f compose.podman.yml"
$CONTAINER info >/dev/null 2>&1 || { echo "ERROR: $CONTAINER is not running (CONTAINER=docker|podman)" >&2; exit 1; }
if ! $CONTAINER image inspect "$IMAGE" >/dev/null 2>&1; then
  case "$IMAGE" in
    */*) echo "pulling $IMAGE…"; $CONTAINER pull -q "$IMAGE" >/dev/null ;;
    *) if [ -x "$HERE/../build.sh" ]; then
         echo "building $IMAGE from the checkouts…"; "$HERE/../build.sh" "$IMAGE" >/dev/null
       else
         echo "ERROR: no image $IMAGE and no checkout to build one: set IDMWEB_IMAGE to a registry image, e.g. IDMWEB_IMAGE=ghcr.io/pointbluetechnology/dirxml-dev-web:latest" >&2; exit 1
       fi ;;
  esac
fi
mkdir -p "$DIR" && cd "$DIR"
cp "$HERE/compose.yml" compose.yml
cp "$HERE/compose.podman.yml" compose.podman.yml
mkdir -p config data lib
[ -f config/hosted.properties ] || cp "$HERE/config/hosted.properties" config/hosted.properties
# the engine jars: never in the image; $DIR/lib is the volume the container reads them from
if [ -z "$(ls lib/*.jar 2>/dev/null)" ]; then
  SRC=${IDM_LIB:-$HERE/../../../../DirXMLDev/lib}
  if [ -n "$(ls "$SRC"/*.jar 2>/dev/null)" ]; then
    cp -L "$SRC"/*.jar lib/ && echo "engine jars: $(ls lib | wc -l | tr -d ' ') copied from $SRC into $DIR/lib"
  else
    echo "NOTE: put the engine jars in $DIR/lib (or run again with IDM_LIB=/path/to/them): dirxml.jar, dirxml_misc.jar, nxsl.jar, xp.jar, CommonDriverShim.jar, jclient.jar, dhutil.jar, XDS.jar, js.jar, ldap.jar — from an IDM engine's lib/dirxml/classes (copy the files, not symlinks). Without them the page runs, but the compile check, the simulator and vault access do not." >&2
  fi
fi
# the repository: your tree under tree/, the corpus under cases/ (with no tree, the page makes the
# first project on first run — from a vault, a Designer project, a repository or a remote)
mkdir -p repo.git
if [ -n "$TREE" ] && [ -z "$(ls repo.git 2>/dev/null)" ]; then
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
if [ -n "$TREE" ]; then
  PROJECT=$(basename "$TREE" | sed 's#[^A-Za-z0-9._-]#-#g')
  [ "$PROJECT" = "tree" ] && PROJECT=$(basename "$(dirname "$TREE")" | sed 's#[^A-Za-z0-9._-]#-#g')
  sed -i.bak "s/^token.user=.*/token.user=${USER:-me}/; s#^public.url=.*#public.url=http://localhost:$PORT#; s/PROJECT/$PROJECT/g" config/hosted.properties
else
  PROJECT=
  # no project yet: the page's first run adds one (the config template's project lines go)
  sed -i.bak "s/^token.user=.*/token.user=${USER:-me}/; s#^public.url=.*#public.url=http://localhost:$PORT#; /PROJECT/d" config/hosted.properties
fi
rm -f config/hosted.properties.bak
cat > .env <<ENV
IDMWEB_IMAGE=$IMAGE
IDMWEB_PORT=$PORT
IDMWEB_UID=$(id -u)
IDMWEB_GID=$(id -g)
COMPOSE_FILE=$(printf '%s' "$COMPOSE_FILES" | sed 's/-f //g; s/ /:/g')
ENV
printf 'CONTAINER=%s\nCOMPOSE=%s\n' "$CONTAINER" "$COMPOSE" > .engine
# the CLI and the simulator, inside the container, in the workspace of a branch (main by default)
cat > idm <<'SH'
#!/bin/sh
# idm inside the container, in the workspace of $IDMWEB_PROJECT (default: the first project) and
# $IDMWEB_BRANCH (default main):  ./idm validate tree
cd "$(dirname "$0")"
. ./.engine
B=${IDMWEB_BRANCH:-main}
P=${IDMWEB_PROJECT:-$(grep '^projects=' config/hosted.properties | cut -d= -f2 | cut -d, -f1)}
U=$(grep '^token.user=' config/hosted.properties | cut -d= -f2)
W="/var/lib/idmweb/workspaces/$(printf '%s' "$P" | sed 's#[^A-Za-z0-9._-]#_#g')/$U/$(printf '%s' "$B" | sed 's#[^A-Za-z0-9._-]#_#g')"
exec $COMPOSE exec -T -w "$W" idmweb idm "$@"
SH
chmod +x idm
$COMPOSE $COMPOSE_FILES up -d >/dev/null
i=0
until curl -s "http://localhost:$PORT/api/session" >/dev/null 2>&1; do i=$((i + 1)); [ $i -gt 40 ] && { $COMPOSE $COMPOSE_FILES logs idmweb | tail -5; exit 1; }; sleep 0.5; done
echo
echo "DirXMLDevWeb is at http://localhost:$PORT"
echo "  sign in with the token in $DIR/idmweb.env   (cat $DIR/idmweb.env)"
if [ -n "$PROJECT" ]; then
  echo "  project '$PROJECT': open a branch (main) on the page; it is cloned under $DIR/data/workspaces/$PROJECT/"
else
  echo "  no tree yet: the page asks where it comes from — export from a vault (set the connection first), import a Designer project or export, use a repository, or clone a remote"
fi
echo "  more trees: 'add a project…' in the page's project picker (a vault, a Designer project, a repository, a directory)"
echo "  the CLI and the simulator in that workspace:  $DIR/idm validate tree    $DIR/idm simulate tree --cases cases"
echo "  vault connections: the page's Connections view, or $DIR/config/environments.properties"
echo "  an agent on this machine: the CLI above, or the API with  Authorization: Bearer \$IDMWEB_AGENT_TOKEN  (second line of idmweb.env)"
echo "  engine jars: $DIR/lib (a volume; the image never holds them)"
echo "  stop: (cd $DIR && $COMPOSE down)"
