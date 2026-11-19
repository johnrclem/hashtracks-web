#!/usr/bin/env bash
#
# agent-merge-pr.sh — a scheduled task's merge, bound to the commit the write gate passed.
#
# Generalizes onboarding-merge-handoff-pr.sh for every agent PR (docs/ops/system.md#write-gate):
#   1. refuses to run unless `gh` acts as the agent bot (the identity preflight, in code);
#   2. waits for CI's `test` check and the `write-gate` status on the PR's head;
#   3. merges with `gh pr merge --squash --match-head-commit <head>`, so GitHub refuses the merge if
#      the head moved after the checks were read.
#
# Usage:
#   bash scripts/agent-merge-pr.sh <pr-number> [--dry-run]
#
# Exit codes:
#   0  merged (or, with --dry-run, would merge)
#   1  a check or the gate failed; PR left open
#   2  checks or the gate still pending at the deadline; PR left open
#   4  the merge itself failed (for example, the head moved); PR left open
#   5  `gh` isn't acting as the agent bot; nothing done
#   64 usage error
#
# Env: AGENT_BOT_LOGIN (default hashtracks-agent[bot]), AGENT_MERGE_WAIT_SECS (default 1500),
#      AGENT_MERGE_POLL_SECS (default 30). Outside a clone, GH_REPO names the repository.

set -uo pipefail

PR="${1:-}"
DRY_RUN=0
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=1
if [[ ! "$PR" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 <pr-number> [--dry-run]" >&2
  exit 64
fi

BOT="${AGENT_BOT_LOGIN:-hashtracks-agent[bot]}"
WAIT_SECS="${AGENT_MERGE_WAIT_SECS:-1500}"
POLL_SECS="${AGENT_MERGE_POLL_SECS:-30}"
GATE="write-gate"
GATE_CREATOR="github-actions[bot]"
CI_CHECK="test"

# 1. Identity, before anything else. An installation token can't call GET /user, so this relies on
#    the agent root's gh shim (infra/agent-root/bin/agent-gh.sh): it mints a token first, exiting 97
#    if it can't, and only then answers `gh api user` with the App's bot login. Outside the root,
#    the real gh answers with the owner's login, and the script stops here.
login="$(gh api user --jq .login 2>/dev/null || true)"
if [[ "$login" != "$BOT" ]]; then
  echo "REFUSED: gh acts as '${login:-unknown}', not $BOT. Run from the agent root (docs/ops/system.md#identity)." >&2
  exit 5
fi

head="$(gh pr view "$PR" --json state,headRefOid --jq 'select(.state == "OPEN") | .headRefOid' 2>/dev/null || true)"
if [[ ! "$head" =~ ^[0-9a-f]{40}$ ]]; then
  echo "PR OPEN: $PR isn't an open pull request (or couldn't be read)" >&2
  exit 4
fi

# One read per poll: "name<TAB>bucket" for every check and status context (CI's test and the gate
# included). `gh pr checks` exits non-zero while anything is pending or failing, so ignore it.
checks() {
  gh pr checks "$PR" --json name,bucket --jq '.[] | "\(.name)\t\(.bucket)"' 2>/dev/null || true
}
bucket_of() {
  local name="$1"
  awk -F'\t' -v n="$name" '$1 == n { print $2; exit }' <<<"$rows"
}

# Who set the newest write-gate status on the head (checked once, when it reports success).
gate_creator() {
  gh api "repos/{owner}/{repo}/commits/${head}/statuses?per_page=100" \
    --jq "[.[] | select(.context == \"$GATE\")][0].creator.login // empty" 2>/dev/null || true
}

# 2. Wait for CI and the gate, on this exact head.
deadline=$((SECONDS + WAIT_SECS))
while :; do
  rows="$(checks)"
  gate_state="$(bucket_of "$GATE")"
  ci="$(bucket_of "$CI_CHECK")"
  if [[ "$gate_state" == "fail" || "$gate_state" == "cancel" ]]; then
    echo "PR OPEN: the write gate refused $PR at ${head:0:7}" >&2
    exit 1
  fi
  if [[ "$ci" == "fail" || "$ci" == "cancel" ]]; then
    echo "PR OPEN: CI's '$CI_CHECK' check failed on $PR" >&2
    exit 1
  fi
  if [[ "$gate_state" == "pass" && "$ci" == "pass" ]]; then
    if [[ "$(gate_creator)" != "$GATE_CREATOR" ]]; then
      echo "PR OPEN: the '$GATE' status on $PR wasn't set by $GATE_CREATOR" >&2
      exit 1
    fi
    break
  fi
  if (( SECONDS >= deadline )); then
    echo "PR OPEN: still waiting on $PR after ${WAIT_SECS}s (gate: ${gate_state:-none}, $CI_CHECK: ${ci:-none})" >&2
    exit 2
  fi
  sleep "$POLL_SECS"
done

# 3. Merge exactly the head the checks passed.
if (( DRY_RUN )); then
  echo "DRY RUN: gate and CI green on ${head:0:7}; would squash-merge $PR"
  exit 0
fi
if ! out="$(gh pr merge "$PR" --squash --match-head-commit "$head" 2>&1)"; then
  echo "PR OPEN: merge failed for $PR at ${head:0:7}: $out" >&2
  exit 4
fi
echo "MERGED: $PR at ${head:0:7}"
