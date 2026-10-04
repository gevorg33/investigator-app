#!/usr/bin/env bash
# The Caddyfile parses, and `caddy fmt` would change nothing (T-202). Only Caddy can say either:
# apps/api/test/edge.spec.ts holds the file's rules as text, not whether it loads.
#
# Run with the image the server stack runs, read from server.yml — one digest to move, and
# Dependabot moves it there. The names are reserved ones (RFC 2606): validation needs every
# variable the file reads, and resolves none of them.
#
#   ./scripts/check-caddyfile.sh [directory holding the Caddyfile]
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
caddy_dir="$(cd "${1:-$root/infrastructure/caddy}" && pwd -P)"

image="$(sed -nE 's/^[[:space:]]*image:[[:space:]]*(caddy:[^[:space:]]+@sha256:[0-9a-f]{64}).*$/\1/p' \
  "$root/infrastructure/compose/server.yml" | head -n 1)"
if [[ -z "$image" ]]; then
  echo "server.yml names no digest-pinned caddy image to validate with." >&2
  exit 1
fi

docker run --rm -v "$caddy_dir:/etc/caddy:ro" \
  -e DOMAIN=example.test -e APP_HOST=app.example.test -e ADMIN_HOST=admin.example.test \
  -e NEWS_HOST=news.example.test -e ACME_EMAIL=ops@example.test \
  "$image" \
  sh -c 'caddy validate --config /etc/caddy/Caddyfile && caddy fmt --diff /etc/caddy/Caddyfile'
