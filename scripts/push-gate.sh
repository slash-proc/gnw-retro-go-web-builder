#!/usr/bin/env bash
set -euo pipefail

# Honor-system push gate. Keep this aligned with the production Pages workflow:
# internal packages first, then the complete web workspace build.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "== push gate: diff check"
if git -c "safe.directory=$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -c "safe.directory=$repo_root" diff --check
else
  echo "(skipped: this source-only environment has no .git directory)"
fi

echo "== push gate: internal packages"
tsc_bin="$repo_root/node_modules/.bin/tsc"
if [[ ! -x "$tsc_bin" ]]; then
  echo "ERROR: local TypeScript compiler is missing ($tsc_bin)"
  echo "Run npm ci (or the repository's dependency setup) before running the push gate."
  exit 1
fi
"$tsc_bin" -b \
  packages/builder-core \
  packages/fs-builders \
  packages/gnw-flasher \
  packages/gnw-patch \
  packages/swd-transport \
  packages/thumb-asm

echo "== push gate: web production build"
PUBLIC_BASE="${PUBLIC_BASE:-/gnw-retro-go-web-builder/}" \
PUBLIC_STORAGE_SCOPE="${PUBLIC_STORAGE_SCOPE:-}" \
npm run build --workspace @gnw/web

echo "== push gate: PASSED"
