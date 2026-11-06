#!/usr/bin/env bash
#
# copy-newest-handoff.sh — copy an un-implemented kennel onboarding handoff to the macOS
# clipboard, so you can paste it as the first message into a fresh local Claude Code session
# and let its "▶ FOR CLAUDE CODE" directive drive implementation → PR.
#
# 🔴 WHY THIS SCRIPT IS THE WAY IT IS — it has now hidden a backlog three times
# (4 kennels on 2026-07-05, 6 on 2026-07-15, **20** on 2026-08-11). Two root causes:
#
#   1. It only ever surfaced the NEWEST handoff, so skipped days piled up silently.
#      → Fixed here: a loud backlog banner, oldest-first, plus --oldest / --list.
#   2. It judged "implemented" solely by `onboard/<code>-*` existing on origin. A handoff
#      that was never COMMITTED never gets a branch, so that test reported it as done.
#      → Fixed here: the authoritative test is seed presence (a kennelCode must be seeded in
#        kennels.ts AND linked by a sources.ts kennelCodes array — checked by importing the
#        seed data, #2673); the branch check is only a secondary skip.
#
# Definitions:
#   implemented — every kennelCode in the handoff is in prisma/seed-data/kennels.ts AND in some
#                 source's kennelCodes in prisma/seed-data/sources.ts (authoritative; evaluated by
#                 scripts/print-seeded-kennel-codes.ts), OR an onboard/<code>-* branch
#                 exists on origin (secondary — catches in-flight work not yet merged).
#   blocked     — a retro exists at handoffs/retros/<same-date>-<code>-retro.md. Per the handoffs
#                 README, a handoff stopped at the live-verify gate gets a "not-onboarded" retro,
#                 so it is resolved, not backlog (e.g. 2026-06-09-lima-h3, dormant source).
#   voided      — "VOID" appears in the first 8 lines.
#
# Usage:
#   bash scripts/copy-newest-handoff.sh            # copy the NEWEST actionable handoff
#   bash scripts/copy-newest-handoff.sh --oldest   # copy the OLDEST actionable handoff (drain a backlog)
#   bash scripts/copy-newest-handoff.sh --list     # audit only; print the backlog, copy nothing
#   bash scripts/copy-newest-handoff.sh --paths    # machine-readable: actionable paths, oldest first
#
# Suggested alias (drop in ~/.zshrc):
#   alias htn='bash ~/Developer/hashtracks-web/scripts/copy-newest-handoff.sh'
#
# NOTE: bash, not sh/zsh, is required — zsh does not word-split unquoted variables, which silently
# broke the older inline audit loop (a multi-kennelCode handoff collapsed into one grep pattern and,
# because grep treats an embedded newline as pattern-OR, false-passed as "shipped"). That is exactly
# how 2026-08-07-donnington-h3 hid. All iteration here is newline-safe via while-read.

set -euo pipefail

REPO="${HASHTRACKS_REPO:-$HOME/Developer/hashtracks-web}"
HANDOFF_DIR="$REPO/docs/kennel-onboarding/handoffs"
RETRO_DIR="$HANDOFF_DIR/retros"
KENNELS="$REPO/prisma/seed-data/kennels.ts"
SOURCES="$REPO/prisma/seed-data/sources.ts"

MODE="newest"
case "${1:-}" in
  --oldest) MODE="oldest" ;;
  --list)   MODE="list" ;;
  --paths)  MODE="paths" ;;
  "")       ;;
  *) echo "Unknown option: $1 (expected --oldest, --list, --paths, or no argument)" >&2; exit 2 ;;
esac

[[ -d "$HANDOFF_DIR" ]] || { echo "No handoffs dir: $HANDOFF_DIR" >&2; exit 1; }
# Fail loud rather than silently treating every handoff as un-implemented.
[[ -s "$KENNELS" ]] || { echo "Missing/empty seed file: $KENNELS" >&2; exit 1; }
[[ -s "$SOURCES" ]] || { echo "Missing/empty seed file: $SOURCES" >&2; exit 1; }

# Fully-seeded kennelCodes (in KENNELS *and* linked by some SOURCES[].kennelCodes), computed ONCE
# by importing the seed-data modules (#2673). A text grep can't scope this: sources.ts references
# arrays by identifier (`kennelCodes: sfh3KennelCodes`) and splits arrays across lines, and a code
# quoted anywhere else in the file would false-pass. The TS helper sees the evaluated arrays.
SEEDED_CODES="$(cd "$REPO" && npx --no-install tsx scripts/print-seeded-kennel-codes.ts)" || {
  echo "Could not list seeded kennelCodes (needs node_modules: run npm install in $REPO)" >&2
  exit 1
}

# Returns 0 (true) when every kennelCode in $1 is fully seeded.
is_implemented_in_seed() {
  local file="$1" code found_any=0
  while IFS= read -r code; do
    [[ -z "$code" ]] && continue
    found_any=1
    grep -Fxq -- "$code" <<< "$SEEDED_CODES" || return 1
  done < <(grep -oE 'kennelCode: *"[a-z0-9-]+"' "$file" \
             | grep -oE '"[a-z0-9-]+"' | tr -d '"' | sort -u)
  # A handoff with no parseable kennelCode can't be judged — treat as NOT implemented so it
  # surfaces for a human rather than vanishing.
  [[ "$found_any" -eq 1 ]]
}

backlog=()   # actionable handoffs, oldest-first
while IFS= read -r f; do
  base="$(basename "$f")"
  head -8 "$f" | grep -qi VOID && continue

  # "YYYY-MM-DD-<code>.md" → date + code
  date_part="${base:0:10}"
  code="$(echo "$base" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-(.+)\.md$/\1/')"

  # Resolved as a documented block (dormant/dead source) if it has its own retro.
  [[ -f "$RETRO_DIR/${date_part}-${code}-retro.md" ]] && continue

  is_implemented_in_seed "$f" && continue

  # Secondary: in-flight work that hasn't merged to seed yet. Capture output before testing it —
  # piping straight into `grep -q` under `pipefail` risks git ls-remote receiving SIGPIPE when grep
  # closes the pipe after its first match, which can make the whole pipeline's exit status nonzero
  # even though a match WAS found, silently re-adding an in-flight handoff to the backlog.
  remote_refs="$(cd "$REPO" && git ls-remote --heads origin "onboard/${code}-*" 2>/dev/null || true)"
  if [[ -n "$remote_refs" ]]; then
    continue
  fi

  backlog+=("$f")
# Glob is constrained to the YYYY-MM-DD-<code>.md format so README.md (and any future non-handoff
# .md) never match. `sort` on the filename is a true chronological sort — unlike the previous
# `ls -t`, which used mtime and reordered on any touch/checkout.
done < <(ls "$HANDOFF_DIR"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md 2>/dev/null | sort || true)

count="${#backlog[@]}"

# Machine-readable mode for the unattended implementer: one absolute path per line, oldest
# first, no banner. Prints nothing when the backlog is empty.
if [[ "$MODE" == "paths" ]]; then
  (( count > 0 )) && printf '%s\n' "${backlog[@]}"
  exit 0
fi

if [[ "$count" -eq 0 ]]; then
  echo "No un-implemented handoffs found."
  exit 0
fi

# 🔴 Make a backlog impossible to miss — this is the whole point of the rewrite.
if [[ "$count" -gt 1 ]]; then
  echo "════════════════════════════════════════════════════════════════════"
  echo "🔴 BACKLOG: ${count} un-implemented handoffs (oldest first)"
  echo "════════════════════════════════════════════════════════════════════"
  for f in "${backlog[@]}"; do echo "   $(basename "$f")"; done
  echo "────────────────────────────────────────────────────────────────────"
  echo "   Config-only handoffs of the same adapter type are best shipped as"
  echo "   ONE batch PR (see the hc-batch-4 / -6 / -10 precedent)."
  echo "   Drain oldest-first with: bash scripts/copy-newest-handoff.sh --oldest"
  echo "════════════════════════════════════════════════════════════════════"
  echo ""
fi

[[ "$MODE" == "list" ]] && exit 0

if [[ "$MODE" == "oldest" ]]; then
  target="${backlog[0]}"
else
  target="${backlog[$((count - 1))]}"
fi

command -v pbcopy >/dev/null 2>&1 || {
  echo "pbcopy not found (macOS only) — showing the target instead: $target" >&2
  exit 1
}

pbcopy < "$target"
bytes="$(wc -c < "$target" | tr -d ' ')"
echo "Copied to clipboard (${MODE}): $(basename "$target") (${bytes} bytes)"
echo "Open a fresh Claude Code session in $REPO and paste."
