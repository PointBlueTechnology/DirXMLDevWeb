#!/bin/sh
# Says what is mounted, then runs idmweb (or whatever command was given).
set -e
if [ ! -f /etc/idmweb/hosted.properties ] && [ "$1" = "serve" ]; then
  echo "ERROR: mount hosted.properties at /etc/idmweb/hosted.properties (see docs/hosted-install.md)" >&2
  exit 1
fi
n=$(ls /opt/idm/lib/*.jar 2>/dev/null | wc -l | tr -d ' ')
if [ "$n" = "0" ]; then
  echo "WARNING: no engine jars at /opt/idm/lib; validation's compile check, the simulator and vault access need them (mount the customer's lib/)." >&2
fi
case "$1" in
  idm) shift; exec /opt/idmweb/bin/idm "$@" ;;
  serve|version) exec /opt/idmweb/bin/idmweb "$@" ;;
  *) exec "$@" ;;
esac
