#!/bin/sh
# Start a throwaway XWiki (official Docker image + Postgres) for the integration tests.
# Usage: scripts/start-xwiki.sh [image-tag] [port]
#   image-tag  e.g. lts-postgres-tomcat (default) or stable-postgres-tomcat
# Enables the superadmin account (password from XWIKI_IT_PASSWORD, default "admin") and
# turns off the setup wizard, then waits until the REST API answers. Remove with:
#   docker rm -f xwiki-it xwiki-it-db && docker network rm xwiki-it
set -eu

TAG="${1:-lts-postgres-tomcat}"
PORT="${2:-8080}"
PASSWORD="${XWIKI_IT_PASSWORD:-admin}"
REGISTRY="${XWIKI_IT_REGISTRY:-docker.io/library}"
WEBINF=/usr/local/tomcat/webapps/ROOT/WEB-INF

docker network create xwiki-it >/dev/null 2>&1 || true
docker run -d --name xwiki-it-db --network xwiki-it \
  -e POSTGRES_USER=xwiki -e POSTGRES_PASSWORD=xwiki -e POSTGRES_DB=xwiki \
  "$REGISTRY/postgres:17" >/dev/null
docker run -d --name xwiki-it --network xwiki-it -p "$PORT:8080" \
  -e DB_USER=xwiki -e DB_PASSWORD=xwiki -e DB_DATABASE=xwiki -e DB_HOST=xwiki-it-db \
  "$REGISTRY/xwiki:$TAG" >/dev/null

wait_for() {
  i=0
  until [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 $1 "http://127.0.0.1:$PORT/rest/wikis/xwiki/spaces?media=json")" = 200 ]; do
    i=$((i + 1))
    [ "$i" -gt 120 ] && { echo "XWiki did not start" >&2; docker logs xwiki-it | tail -50 >&2; exit 1; }
    sleep 5
  done
}

wait_for ""
docker exec xwiki-it sh -c "
  sed -i 's/^# xwiki.superadminpassword=.*/xwiki.superadminpassword=$PASSWORD/' $WEBINF/xwiki.cfg &&
  sed -i 's/^# distribution.automaticStartOnMainWiki=.*/distribution.automaticStartOnMainWiki=false/; s/^# distribution.automaticStartOnWiki=.*/distribution.automaticStartOnWiki=false/' $WEBINF/xwiki.properties"
docker restart xwiki-it >/dev/null
wait_for "-u superadmin:$PASSWORD"
echo "XWiki $(docker exec xwiki-it printenv XWIKI_VERSION) ready on http://127.0.0.1:$PORT"
