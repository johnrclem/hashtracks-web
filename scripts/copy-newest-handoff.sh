#!/usr/bin/env bash
#
# copy-newest-handoff.sh — copy the newest un-implemented kennel onboarding handoff to the
# macOS clipboard, so you can paste it as the first message into a fresh local Claude Code
# session and let its "▶ FOR CLAUDE CODE" directive drive implementation → PR.
#
# "Un-implemented" = no `onboard/<code>-*` branch exists on origin yet (so re-runs are idempotent).
# Voided handoffs (first 5 lines contain "VOID") are skipped.
#
# Usage:
#   bash scripts/copy-newest-handoff.sh
#
# Suggested alias (drop in ~/.zshrc):
#   alias htn='bash ~/Developer/hashtracks-web/scripts/copy-newest-handoff.sh'

set -euo pipefail

REPO="${HASHTRACKS_REPO:-$HOME/Developer/hashtracks-web}"
HANDOFF_DIR="$REPO/docs/kennel-onboarding/handoffs"

[ -d "$HANDOFF_DIR" ] || { echo "No handoffs dir: $HANDOFF_DIR" >&2; exit 1; }
command -v pbcopy >/dev/null 2>&1 || { echo "pbcopy not found (macOS only)" >&2; exit 1; }

target=""
while IFS= read -r f; do
  base="$(basename "$f")"
  # Skip voided handoffs (the void marker is in the first ~5 lines)
  head -5 "$f" | grep -qi VOID && continue
  # Derive <code> from "YYYY-MM-DD-<code>.md"
  code="$(echo "$base" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-(.+)\.md$/\1/')"
  # If an implementation branch already exists on origin for this code, skip it
  if (cd "$REPO" && git ls-remote --heads origin "onboard/${code}-*" 2>/dev/null | grep -q .); then
    continue
  fi
  target="$f"; break
# Glob is constrained to the YYYY-MM-DD-<code>.md format so README.md (and any future non-handoff
# .md) never match.
done < <(ls -t "$HANDOFF_DIR"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md 2>/dev/null || true)

if [ -z "$target" ]; then
  echo "No un-implemented handoffs found."
  exit 0
fi

pbcopy < "$target"
bytes="$(wc -c < "$target" | tr -d ' ')"
echo "Copied to clipboard: $(basename "$target") (${bytes} bytes)"
echo "Open a fresh Claude Code session in $REPO and paste."
