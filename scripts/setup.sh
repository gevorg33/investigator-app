#!/usr/bin/env bash
# Local bootstrap. Idempotent — safe to re-run.
#
#   ./scripts/setup.sh
#
# Does everything that does not require one of your accounts. What is left after this
# runs is in ACTIONS-FOR-ME.md.
set -euo pipefail

cd "$(dirname "$0")/.."
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
die()  { printf "  \033[31m✗\033[0m %s\n" "$1"; exit 1; }

echo "Investigator platform — local setup"
echo

# ── Node ────────────────────────────────────────────────────────────────────────
echo "Node"
want="$(cat .nvmrc)"
have="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1 || echo none)"
if [ "$have" = "$want" ]; then
  ok "node $(node --version)"
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  warn "node v$have active, want v$want — installing via nvm"
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" && nvm install "$want" >/dev/null && nvm use "$want" >/dev/null
  ok "node $(node --version)"
else
  die "node v$want required (.nvmrc). Install nvm, or install Node $want manually."
fi

# ── pnpm ────────────────────────────────────────────────────────────────────────
echo
echo "Package manager"
if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm $(pnpm --version)"
else
  warn "pnpm missing — enabling via corepack"
  corepack enable pnpm >/dev/null 2>&1 || die "corepack enable failed. Run: npm i -g pnpm"
  ok "pnpm $(pnpm --version)"
fi

# ── Dependencies ────────────────────────────────────────────────────────────────
echo
echo "Dependencies"
pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null 2>&1
ok "installed ($(pnpm list -r --depth -1 2>/dev/null | grep -c '^@investigator/' || echo '?') workspaces)"

# ── Environment ─────────────────────────────────────────────────────────────────
echo
echo "Environment"
ENVFILE=".env.local"
if [ -f "$ENVFILE" ]; then
  ok "$ENVFILE exists — left untouched"
else
  cp .env.example "$ENVFILE"
  # Generated locally. This is not an external credential and needs no account.
  secret="$(node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))")"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^SESSION_SECRET=.*|SESSION_SECRET=${secret}|" "$ENVFILE"
  else
    sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${secret}|" "$ENVFILE"
  fi
  ok "$ENVFILE created, SESSION_SECRET generated"
fi

# ── Services ────────────────────────────────────────────────────────────────────
echo
echo "Services"
if docker info >/dev/null 2>&1; then
  if [ -f infrastructure/compose/local.yml ]; then
    docker compose -f infrastructure/compose/local.yml up -d >/dev/null 2>&1 \
      && ok "postgres + redis running" \
      || warn "compose failed — check: docker compose -f infrastructure/compose/local.yml logs"
  else
    warn "infrastructure/compose/local.yml not created yet (T-003)"
  fi
else
  warn "Docker not running — start Docker Desktop, then re-run. Needed for the database (T-003)."
fi

# ── Verify ──────────────────────────────────────────────────────────────────────
echo
echo "Verifying"
pnpm exec tsc --build >/dev/null 2>&1 && ok "typecheck" || die "typecheck failed"
pnpm lint          >/dev/null 2>&1 && ok "lint"      || die "lint failed"
pnpm build         >/dev/null 2>&1 && ok "build"     || die "build failed"
pnpm --filter api test >/dev/null 2>&1 && ok "api tests" || warn "api tests failed — run: pnpm --filter api test"

echo
echo "Done. Remaining manual steps are in ACTIONS-FOR-ME.md"
