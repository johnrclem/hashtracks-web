#!/usr/bin/env bash
#
# onboard-implement.sh — auto-implement the newest kennel onboarding handoff with Claude Code.
#
# **PARKED.** Current default workflow is manual paste via scripts/copy-newest-handoff.sh.
# This script is kept as a fallback for fully-hands-off local automation if needed.
#
# Pairs with the Cowork "onboard-daily-kennel" research task: that task writes a handoff to
# docs/kennel-onboarding/handoffs/<date>-<kennel>.md each morning (~6 AM). This script (run ~7 AM
# via launchd) picks up the newest un-implemented, non-voided handoff and runs Claude Code headless
# to branch → seed → configure adapter → live-verify → tsc/lint/test → open a PR, then STOP.
#
# It works in an ISOLATED clean clone of main (BOT_DIR) so it never touches your dev working tree.
#
# Prerequisites on this machine (one-time):
#   - `claude` CLI installed and authenticated     (https://docs.claude.com/claude-code)
#   - `gh` CLI installed and authenticated          (gh auth status)  — for opening the PR
#   - Node via fnm with Node 20 available
#   - The dev repo present with a working .env / .env.local (DATABASE_URL etc.) and an `origin` remote
#
# First time: run it by hand once and watch the log — `bash scripts/onboard-implement.sh`.

set -euo pipefail

# ---- config (override via env if needed) ----
DEV_REPO="${HASHTRACKS_REPO:-$HOME/Developer/hashtracks-web}"
BOT_DIR="${HASHTRACKS_BOT_DIR:-$HOME/.hashtracks-onboard-bot}"
LOG="${HASHTRACKS_BOT_LOG:-$HOME/Library/Logs/hashtracks-onboard.log}"
# Permission flags for headless Claude Code. Default lets it edit files and run shell/git/gh.
# If it stalls waiting for approvals in the log, switch to: PERM_FLAGS="--dangerously-skip-permissions"
PERM_FLAGS="${HASHTRACKS_PERM_FLAGS:---permission-mode acceptEdits --allowedTools Bash Edit Write Read Glob Grep WebFetch}"

HANDOFF_DIR="$DEV_REPO/docs/kennel-onboarding/handoffs"
DONE_LOG="$DEV_REPO/docs/kennel-onboarding/.implemented.log"

mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
echo "==================================================================="
echo "=== $(date '+%Y-%m-%d %H:%M:%S')  onboard-implement run ==="

# Make common tool paths available under launchd's minimal environment.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.fnm:$PATH"
command -v fnm >/dev/null 2>&1 && eval "$(fnm env)" && fnm use 20 >/dev/null 2>&1 || true

command -v claude >/dev/null 2>&1 || { echo "FATAL: 'claude' CLI not found in PATH"; exit 1; }
command -v gh >/dev/null 2>&1 || echo "WARN: 'gh' not found — PR creation may fail"
[ -d "$DEV_REPO/.git" ] || { echo "FATAL: dev repo not found at $DEV_REPO"; exit 1; }

# ---- pick newest handoff: not README, not voided, not already implemented ----
touch "$DONE_LOG"
target=""
while IFS= read -r f; do
  base="$(basename "$f")"
  [ "$base" = "README.md" ] && continue
  if head -5 "$f" | grep -qi 'VOID'; then echo "skip (voided): $base"; continue; fi
  if grep -qxF "$base" "$DONE_LOG"; then continue; fi
  target="$f"; break
done < <(ls -t "$HANDOFF_DIR"/*.md 2>/dev/null || true)

if [ -z "$target" ]; then echo "Nothing to do — no new handoff."; exit 0; fi
target_base="$(basename "$target")"
echo "Implementing handoff: $target_base"

# ---- refresh an isolated clean clone on origin/main ----
if [ ! -d "$BOT_DIR/.git" ]; then
  origin="$(git -C "$DEV_REPO" remote get-url origin)"
  echo "Cloning $origin → $BOT_DIR"
  git clone "$origin" "$BOT_DIR"
fi
git -C "$BOT_DIR" fetch origin --prune
git -C "$BOT_DIR" checkout -f main
git -C "$BOT_DIR" reset --hard origin/main
git -C "$BOT_DIR" clean -fd

# carry over secrets (gitignored) so prisma seed + live-verify can reach the DB
cp "$DEV_REPO/.env" "$BOT_DIR/.env" 2>/dev/null || true
cp "$DEV_REPO/.env.local" "$BOT_DIR/.env.local" 2>/dev/null || true

# install deps if missing
[ -d "$BOT_DIR/node_modules" ] || (cd "$BOT_DIR" && npm ci)

# bring the handoff into the clone so it can be committed into the PR
mkdir -p "$BOT_DIR/docs/kennel-onboarding/handoffs"
cp "$target" "$BOT_DIR/docs/kennel-onboarding/handoffs/$target_base"

# ---- run Claude Code headless, feeding the WHOLE handoff (its top directive drives the work) ----
cd "$BOT_DIR"
PROMPT="$(cat "$target")

-----
You are running UNATTENDED in an isolated clean clone of main. Implement the onboarding described
in the file content above, following its '▶ FOR CLAUDE CODE' directive exactly. Open a PR with
\`gh\` and then STOP — do NOT merge. Also \`git add\` the handoff file at
docs/kennel-onboarding/handoffs/$target_base so it's part of the PR. If you cannot complete it
(e.g. live source verification fails and the documented fallback also fails), open a DRAFT PR
titled 'WIP: onboard ...' explaining what blocked you, rather than merging or leaving nothing."

echo "--- claude -p starting ---"
# shellcheck disable=SC2086
claude -p "$PROMPT" $PERM_FLAGS || { echo "claude run exited non-zero for $target_base"; exit 1; }
echo "--- claude -p finished ---"

# ---- mark processed so the next run skips it ----
echo "$target_base" >> "$DONE_LOG"
echo "=== done: $target_base ==="
