#!/usr/bin/env bash
# Fails if a bundle served to the public carries a source map (T-028, launch-hardening).
#
#   ./scripts/check-no-public-sourcemaps.sh [repo-root]
#
# Source maps reconstruct the source — comments, internal route names, the lot. Checked on the
# build output rather than on configuration: whatever produced a map, the build output is where
# it would be served from. Two shapes are refused: a `.map` file, and a script that points at one
# with `sourceMappingURL=` (an inline map is the same disclosure in a single file).
#
# Public means the three web apps. The API keeps its maps — it is a server, and they are how an
# error tracker turns a stack trace into lines of code.
set -euo pipefail

root="${1:-.}"
public=(apps/app-web apps/admin-web apps/marketing-web)

found=()
for app in "${public[@]}"; do
  for out in "$root/$app/dist" "$root/$app/.next/static"; do
    [ -d "$out" ] || continue
    while IFS= read -r f; do found+=("$f"); done < <(find "$out" -type f -name '*.map')
    while IFS= read -r f; do found+=("$f"); done < <(grep -rl --include='*.js' --include='*.mjs' 'sourceMappingURL=' "$out" || true)
  done
done

if [ "${#found[@]}" -gt 0 ]; then
  echo "Source maps in a public bundle:"
  printf '  %s\n' "${found[@]}"
  exit 1
fi
echo "No source maps in public bundles."
