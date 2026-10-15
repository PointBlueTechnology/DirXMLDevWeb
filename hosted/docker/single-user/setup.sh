#!/bin/sh
# One person, one container, one command:
#   setup.sh                     start with nothing: the page asks where the tree comes from
#                                (export from a vault, a Designer project or export, a repository, a remote)
#   setup.sh <tree> [<dir>]      start with an IDM-as-code tree you already have
#   setup.sh - <dir>             no tree, another folder
# Makes <dir> (default ~/idmweb): a bare repository holding your tree when you gave one, the access
# tokens, the configuration, the engine jars when it finds them (optional: only validate's compile
# check and the simulator need them), and starts the container. Prints a link that signs you in.
# Re-running on an existing <dir> keeps its repository, tokens and configuration and just
# (re)starts the container (a new IDMWEB_IMAGE is picked up).
#   IDMWEB_IMAGE   the image. Default: the release this bundle came with
#                  (ghcr.io/pointbluetechnology/dirxml-dev-web:<its version>, pulled); from a checkout,
#                  dirxml-dev-web:latest built from the checkouts. :latest follows every release.
#   IDMWEB_PORT    the page's port on localhost (default 8080)
#   IDM_LIB        where the engine jars are
#   CONTAINER      docker (default) or podman; COMPOSE overrides the compose command ("podman compose",
#                  "podman-compose", "docker compose"). Rootless Podman keeps your uid inside the
#                  container through compose.podman.yml (userns keep-id), so files stay yours.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ARG=${1:--}
TREE=
if [ "$ARG" != "-" ]; then
  TREE=$(cd "$ARG" && pwd)
  [ -f "$TREE/driverset.xml" ] || { echo "ERROR: $TREE is not an IDM-as-code tree (no driverset.xml); pass - to start without one" >&2; exit 1; }
fi
DIR=${2:-$HOME/idmweb}
# the bundle on a release carries VERSION (image.yml writes it): its own image is the default
if [ -z "${IDMWEB_IMAGE:-}" ] && [ -f "$HERE/VERSION" ]; then
  IDMWEB_IMAGE="ghcr.io/pointbluetechnology/dirxml-dev-web:$(tr -d ' \n' < "$HERE/VERSION")"
fi
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
# the engine jars: never in the image; $DIR/lib is the volume the container reads them from. Optional:
# the page, vault access and the driver operations work without them
if [ -z "$(ls lib/*.jar 2>/dev/null)" ]; then
  SRC=${IDM_LIB:-$HERE/../../../../DirXMLDev/lib}
  if [ -n "$(ls "$SRC"/*.jar 2>/dev/null)" ]; then
    cp -L "$SRC"/*.jar lib/ && echo "engine jars: $(ls lib | wc -l | tr -d ' ') copied from $SRC into $DIR/lib" && NEWJARS=1
  else
    echo "engine jars: none yet (optional). Validate's compile check and the simulator need them: put dirxml.jar, dirxml_misc.jar, nxsl.jar, xp.jar, CommonDriverShim.jar, jclient.jar, dhutil.jar, XDS.jar and js.jar from an IDM engine's lib/dirxml/classes in $DIR/lib (files, not symlinks), or run again with IDM_LIB=/path/to/them. Everything else works without them."
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
# the environments: the definitions (URL, driver set, tier) in config/environments.properties, your
# bind DN and passwords in your own file under data/users/ (docs/multi-user.md); the server will not
# start with a password in config/. Yours from IDM_ENVIRONMENTS if you have one, else empty (the
# page's Connections view fills both). An older install's config/ file with passwords is split too.
U=$(grep '^token.user=' config/hosted.properties | cut -d= -f2)
MINE_DIR="data/users/$(printf '%s' "${U:-me}" | sed 's#[^A-Za-z0-9._-]#_#g')"
MINE="$MINE_DIR/environments.properties"
CRED='^[[:space:]]*[^.=:[:space:]#!]+\.(bindDn|trustAll|[A-Za-z0-9_]*[pP]assword(Env|Command|Keychain)?)[[:space:]]*[=:]'
split_environments() {  # $1: a CLI environments file; definitions to config/, credentials to $MINE
  mkdir -p "$MINE_DIR" && chmod 700 "$MINE_DIR"
  [ -f "$MINE" ] || : > "$MINE"
  grep -Ev "$CRED" "$1" > config/environments.properties.new || true
  # keys already in your own file stay as they are
  grep -E "$CRED" "$1" | while IFS= read -r line; do
    key=$(printf '%s' "$line" | sed -E 's/^[[:space:]]*([^=:[:space:]]+).*/\1/')
    grep -Eq "^[[:space:]]*$(printf '%s' "$key" | sed 's/[.[\*^$]/\\&/g')[[:space:]]*[=:]" "$MINE" || printf '%s\n' "$line" >> "$MINE"
  done
  mv config/environments.properties.new config/environments.properties
  chmod 600 "$MINE"
  n=$(grep -Ec "$CRED" "$MINE" || true)
  echo "environments: definitions in $DIR/config/environments.properties, your bind DN and passwords in $DIR/$MINE ($n line(s))"
  grep -Eq 'Keychain[[:space:]]*[=:]' "$MINE" && echo "  NOTE: Keychain references do not resolve in the container; set those passwords again under Connections" >&2
  grep -Eq 'Env[[:space:]]*[=:]' "$MINE" && echo "  NOTE: …Env references read the container's environment: add each variable to $DIR/idmweb.env" >&2
  # a relative <env>.secrets file (driver secrets) comes along beside the definitions
  for f in $(sed -nE 's/^[[:space:]]*[^.=:[:space:]]+\.secrets[[:space:]]*[=:][[:space:]]*([^/[:space:]][^[:space:]]*)$/\1/p' config/environments.properties); do
    src="$(dirname "$1")/$f"
    [ -f "$src" ] && [ ! -f "config/$f" ] && [ "$src" != "config/$f" ] && cp "$src" "config/$f" && echo "  driver secrets: copied $f"
  done
  return 0
}
if [ ! -f config/environments.properties ]; then
  if [ -n "$IDM_ENVIRONMENTS" ] && [ -f "$IDM_ENVIRONMENTS" ]; then
    split_environments "$IDM_ENVIRONMENTS"
  else
    : > config/environments.properties
  fi
elif grep -Eq "$CRED" config/environments.properties; then
  cp config/environments.properties config/environments.properties.before-split
  chmod 600 config/environments.properties.before-split
  split_environments config/environments.properties.before-split
  echo "  (the file as it was: $DIR/config/environments.properties.before-split; delete it once the page connects)"
fi
chmod 600 config/*.properties
cat > .env <<ENV
IDMWEB_IMAGE=$IMAGE
IDMWEB_PORT=$PORT
IDMWEB_UID=$(id -u)
IDMWEB_GID=$(id -g)
COMPOSE_FILE=$(printf '%s' "$COMPOSE_FILES" | sed 's/-f //g; s/ /:/g')
ENV
# quoted: COMPOSE is two words for "docker compose" / "podman compose"
printf "CONTAINER='%s'\nCOMPOSE='%s'\n" "$CONTAINER" "$COMPOSE" > .engine
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
S=$(printf '%s' "$U" | sed 's#[^A-Za-z0-9._-]#_#g')
REL="workspaces/$(printf '%s' "$P" | sed 's#[^A-Za-z0-9._-]#_#g')/$S/$(printf '%s' "$B" | sed 's#[^A-Za-z0-9._-]#_#g')"
# your bind DN and password are in your own file, merged over the environments as the page does
CRED="IDM_CREDENTIALS=/var/lib/idmweb/users/$S/environments.properties"
if [ -n "$P" ] && [ -d "data/$REL" ]; then
  exec $COMPOSE exec -T -w "/var/lib/idmweb/$REL" -e "$CRED" idmweb idm "$@"
fi
# no workspace opened yet (or no project): vault and other commands that need no tree still run
[ -n "$P" ] && echo "note: no workspace data/$REL yet (open the branch on the page); running outside one" >&2
exec $COMPOSE exec -T -w /var/lib/idmweb -e "$CRED" idmweb idm "$@"
SH
chmod +x idm
# compose reports its progress on stderr: shown only when the start fails
RUNNING=$($COMPOSE $COMPOSE_FILES ps -q idmweb 2>/dev/null || true)
$COMPOSE $COMPOSE_FILES up -d > .compose-up.log 2>&1 || { cat .compose-up.log >&2; exit 1; }
# jars added to a running container are read at its next start
if [ -n "$RUNNING" ] && [ -n "${NEWJARS:-}" ]; then
  $COMPOSE $COMPOSE_FILES restart idmweb >> .compose-up.log 2>&1 || { cat .compose-up.log >&2; exit 1; }
fi
rm -f .compose-up.log
i=0
until curl -s "http://localhost:$PORT/api/session" >/dev/null 2>&1; do i=$((i + 1)); [ $i -gt 40 ] && { $COMPOSE $COMPOSE_FILES logs idmweb | tail -5; exit 1; }; sleep 0.5; done
TOKEN=$(sed -n 's/^IDMWEB_TOKEN=//p' idmweb.env)
echo
echo "DirXMLDevWeb is at http://localhost:$PORT"
echo "  open this link to sign in (it carries your token; keep it to yourself):"
echo "    http://localhost:$PORT/auth/login#signin=$TOKEN"
echo "  or sign in with the token in $DIR/idmweb.env   (cat $DIR/idmweb.env)"
if [ -n "$PROJECT" ]; then
  echo "  project '$PROJECT': open a branch (main) on the page; it is cloned under $DIR/data/workspaces/$PROJECT/"
else
  echo "  no tree yet: the page asks where it comes from — export from a vault (set the connection first), import a Designer project or export, use a repository, or clone a remote"
fi
echo "  more trees: 'add a project…' in the page's project picker (a vault, a Designer project, a repository, a directory)"
echo "  the CLI and the simulator in that workspace:  $DIR/idm validate tree    $DIR/idm simulate tree --cases cases"
echo "  vault connections: the page's Connections view (environments in $DIR/config/, your bind DN and password in $DIR/$MINE)"
echo "  an agent on this machine: the CLI above, or the API with  Authorization: Bearer \$IDMWEB_AGENT_TOKEN  (second line of idmweb.env)"
echo "  engine jars: $DIR/lib (a volume; the image never holds them)"
echo "  stop: (cd $DIR && $COMPOSE down)"
