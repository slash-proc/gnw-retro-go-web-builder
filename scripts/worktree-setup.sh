#!/bin/sh
# Create (or repair) an agent worktree under .worktrees/, ready to run the full gate set.
#
#   scripts/worktree-setup.sh <name> [branch]
#
# Run it from the MAIN clone, on the host. Idempotent: safe to re-run on an existing
# worktree to repair its links. It never writes anything into the main clone.
#
# What it does, and why each step exists:
#
#   1. `git worktree add` at .worktrees/<name> on branch agent/<name> (or the branch given).
#   2. Symlinks `node_modules` and `apps/web/node_modules` to the main clone's. A worktree has
#      no install of its own and we never install on the host (CLAUDE.md). The `@gnw/*` entries
#      inside those point back into the MAIN clone's `packages/` -- which used to mean a
#      worktree tested a different checkout's build output. That is now handled in git:
#      `apps/web/vite.config.ts` + `apps/web/tsconfig.json` alias `@gnw/*` to `../../packages`,
#      and `apps/web/test/gnwResolve.mjs` does the same for the esbuild suites (plugin) and
#      their own top-level imports (`gnwImport`). So the symlink supplies third-party deps
#      only, and nothing resolves `@gnw/*` through it any more.
#   3. Checks out the submodules the app actually builds against -- `frontend/vendor/webstlink`
#      is aliased by vite and a missing one fails `vite build`.
#   4. Builds the packages (`tsc -b`) INSIDE the dev container, so `packages/*/dist` exists.
#      A fresh worktree has none, and a stale one makes failures look like code regressions.
#
# Everything in 4 runs via `docker compose exec dev`; nothing is installed on the host.
set -eu

name=${1:-}
if [ -z "$name" ]; then
  echo "usage: scripts/worktree-setup.sh <name> [branch]" >&2
  exit 2
fi
branch=${2:-agent/$name}

root=$(cd "$(dirname "$0")/.." && pwd)
wt=$root/.worktrees/$name
# Path as the dev container sees it (the repo root is bind-mounted at /app).
cwt=/app/.worktrees/$name

cd "$root"

# 1. worktree
if [ -d "$wt" ]; then
  echo "== worktree $wt already exists, repairing"
else
  echo "== creating worktree $wt on $branch"
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git worktree add "$wt" "$branch"
  else
    git worktree add -b "$branch" "$wt"
  fi
fi

# 2. node_modules links (third-party deps only; see the header)
link() { # link <target> <linkpath>
  if [ -L "$2" ]; then
    [ "$(readlink "$2")" = "$1" ] || { rm -f "$2"; ln -s "$1" "$2"; }
  elif [ -e "$2" ]; then
    echo "!! $2 exists and is not a symlink -- leaving it alone" >&2
  else
    mkdir -p "$(dirname "$2")"
    ln -s "$1" "$2"
  fi
}
echo "== linking node_modules"
link /app/node_modules "$wt/node_modules"
link /app/apps/web/node_modules "$wt/apps/web/node_modules"

# 3. submodules the build needs
echo "== submodules"
git -C "$wt" submodule update --init frontend/vendor/webstlink

# 4. build the packages inside the container
echo "== tsc -b (in the dev container)"
docker compose exec -T dev sh -c "cd $cwt && npx tsc -b"

cat <<MSG

Worktree ready: $wt   (container: $cwt)

Gates, all from the main clone:
  docker compose exec dev sh -c 'cd $cwt && npx tsc -b'
  docker compose exec dev sh -c 'cd $cwt/apps/web && npm run check'
  docker compose exec dev sh -c 'cd $cwt/apps/web && npx vite build'
  docker compose exec dev sh -c 'cd $cwt/apps/web && node src/lib/sources/test/validate.mjs'

i18n-locale-drift now RUNS in a worktree: the guard derives the container-side
gitdir when the worktree's .git file records an unreachable host path, so
`npm run check` really does police locale drift here. If it ever prints SKIP,
treat that as a broken worktree, not as a pass.
MSG
