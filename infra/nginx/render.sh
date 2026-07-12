#!/usr/bin/env sh
# Render the nginx config template (infra/nginx/zipship.conf) by substituting
# ${ZIPSHIP_*} placeholders from the environment, leaving nginx's own $host /
# $remote_addr / $scheme variables untouched.
#
# Usage:
#   ZIPSHIP_API_UPSTREAM=http://api:5006 \
#   ZIPSHIP_SITES_ROOT=/var/lib/zipship/sites \
#   sh infra/nginx/render.sh < infra/nginx/zipship.conf > /etc/nginx/nginx.conf
#
# Inside the nginx container, drop this in /docker-entrypoint.d/ (it reads the
# template at /etc/nginx/zipship.conf.template and writes /etc/nginx/nginx.conf).
set -eu

: "${ZIPSHIP_LISTEN_PORT:=80}"
: "${ZIPSHIP_MAX_BODY_SIZE:=500m}"
: "${ZIPSHIP_API_UPSTREAM:=http://api:5006}"
: "${ZIPSHIP_SITES_ROOT:=/var/lib/zipship/sites}"
: "${ZIPSHIP_CONSOLE_ROOT:=/var/www/console}"
: "${ZIPSHIP_NGINX_PID:=/run/nginx.pid}"
: "${ZIPSHIP_PROJECTS_CONF:=/etc/nginx/zipship-projects.conf}"

TEMPLATE="${1:-/etc/nginx/zipship.conf.template}"
OUTPUT="${2:-/etc/nginx/nginx.conf}"

# The explicit allow-list protects nginx's own $variables from being expanded.
envsubst \
  '${ZIPSHIP_LISTEN_PORT} ${ZIPSHIP_MAX_BODY_SIZE} ${ZIPSHIP_API_UPSTREAM} ${ZIPSHIP_SITES_ROOT} ${ZIPSHIP_CONSOLE_ROOT} ${ZIPSHIP_NGINX_PID} ${ZIPSHIP_PROJECTS_CONF}' \
  < "$TEMPLATE" \
  > "$OUTPUT"

echo "[render.sh] wrote $OUTPUT"
