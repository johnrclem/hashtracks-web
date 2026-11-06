#!/usr/bin/env bash
#
# onboarding-merge-handoff-pr.sh — wait for CI on a daily-onboarding handoff PR, then squash-merge it.
#
# Used by Step 9 of docs/kennel-onboarding/daily-onboarding-prompt.md. GitHub auto-merge is disabled
# for this repo, so the unattended runner waits for CI itself. Bash only, so it works on stock macOS
# without GNU `timeout`.
#
# Usage:
#   bash scripts/onboarding-merge-handoff-pr.sh <pr-number-or-url> [--dry-run]
#
# Exit codes (the runner reports each one in Step 10):
#   0  merged (or, with --dry-run, would merge)
#   1  a check failed or was cancelled; PR left open
#   2  CI didn't finish within the deadline; PR left open
#   3  the PR changes files outside docs/kennel-onboarding/; refused, PR left open
#   4  CI passed but `gh pr merge` failed; PR left open
#   64 usage error
#
# Env: ONBOARDING_CI_WAIT_SECS (default 1500 = 25 min), ONBOARDING_CI_POLL_SECS (default 30),
#      ONBOARDING_CI_APPEAR_SECS (default 300: how long to wait for the `test` check to register).

set -uo pipefail

PR="${1:-}"
DRY_RUN=0
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=1
if [[ -z "$PR" ]]; then
  echo "usage: $0 <pr-number-or-url> [--dry-run]" >&2
  exit 64
fi

WAIT_SECS="${ONBOARDING_CI_WAIT_SECS:-1500}"
POLL_SECS="${ONBOARDING_CI_POLL_SECS:-30}"
APPEAR_SECS="${ONBOARDING_CI_APPEAR_SECS:-300}"
ALLOWED_PREFIX="docs/kennel-onboarding/"

# 1. Refuse anything that isn't docs-only. This enforces the manual's rule at merge time.
files="$(gh pr diff "$PR" --name-only)" || { echo "PR OPEN: could not list changed files for $PR" >&2; exit 4; }
outside="$(printf '%s\n' "$files" | grep -v '^$' | grep -v "^${ALLOWED_PREFIX}" || true)"
if [[ -n "$outside" ]]; then
  echo "REFUSED: $PR changes files outside ${ALLOWED_PREFIX}:" >&2
  printf '%s\n' "$outside" >&2
  exit 3
fi

# Prints "name<TAB>bucket" per check; empty while GitHub hasn't attached any yet.
# `gh pr checks` exits non-zero while checks are pending or failing, so ignore its status.
checks() {
  gh pr checks "$PR" --json name,bucket --jq '.[] | "\(.name)\t\(.bucket)"' 2>/dev/null || true
}

# 2. Wait for the CI `test` job to register. Merging before it exists would skip the real gate.
deadline=$((SECONDS + APPEAR_SECS))
until checks | grep -q $'^test\t'; do
  if (( SECONDS >= deadline )); then
    echo "PR OPEN: the CI 'test' check never registered on $PR within ${APPEAR_SECS}s" >&2
    exit 2
  fi
  sleep 10
done

# 3. Poll until every check is pass/skipping, or one fails.
deadline=$((SECONDS + WAIT_SECS))
while :; do
  rows="$(checks)"
  failed="$(printf '%s\n' "$rows" | awk -F'\t' '$2=="fail" || $2=="cancel" {print $1}')"
  if [[ -n "$failed" ]]; then
    echo "PR OPEN: checks failed on $PR: $(printf '%s' "$failed" | paste -sd, -)" >&2
    exit 1
  fi
  pending="$(printf '%s\n' "$rows" | awk -F'\t' 'NF==2 && $2!="pass" && $2!="skipping" {print $1}')"
  if [[ -z "$pending" ]]; then
    break
  fi
  if (( SECONDS >= deadline )); then
    echo "PR OPEN: checks still pending on $PR after ${WAIT_SECS}s: $(printf '%s' "$pending" | paste -sd, -)" >&2
    exit 2
  fi
  sleep "$POLL_SECS"
done

# 4. Merge.
if (( DRY_RUN )); then
  echo "DRY RUN: all checks green and docs-only; would squash-merge $PR"
  exit 0
fi
if ! out="$(gh pr merge "$PR" --squash 2>&1)"; then
  echo "PR OPEN: CI passed but merge failed for $PR: $out" >&2
  exit 4
fi
echo "MERGED: $PR"
