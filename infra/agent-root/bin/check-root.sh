#!/usr/bin/env bash
#
# check-root.sh — is the agent root still what install.sh made it? Read-only; the ops digest runs it
# every morning (docs/ops/daily-digest-task.md, Gather 6).
#
#   check-root.sh [repo-settings.json]   default: main's .claude/settings.json, fetched over HTTPS
#
# Prints "root-settings: OK" or "root-settings: DRIFT: <what>", one line, and exits 0 or 1. It
# checks that every deny rule in the repo's settings is also denied here, that the env block still
# gives gh an empty config, empty tokens and the shim first on PATH, and that the shim and its
# config are in place. Never prints a secret.

set -uo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
LOCAL="$ROOT/.claude/settings.local.json"
problems=()

if [[ -n "${1:-}" ]]; then
  repo_settings="$(cat "$1" 2>/dev/null)"
else
  repo_settings="$(curl -fsSL --max-time 20 https://raw.githubusercontent.com/johnrclem/hashtracks-web/main/.claude/settings.json)"
fi
[[ -n "$repo_settings" ]] || problems+=("the repo's .claude/settings.json is unreadable")

if ! jq -e . "$LOCAL" >/dev/null 2>&1; then
  problems+=("$LOCAL is missing or not JSON")
else
  if [[ -n "$repo_settings" ]]; then
    missing="$(jq -rn --argjson repo "$repo_settings" --slurpfile mine "$LOCAL" \
      '(($repo.permissions.deny // []) - ($mine[0].permissions.deny // [])) | join(", ")')"
    [[ -z "$missing" ]] || problems+=("deny rules missing here: $missing")
  fi
  env_problems="$(jq -r --arg root "$ROOT" '
    .env as $e
    | [ (if $e.GH_CONFIG_DIR != ($root + "/.agent/gh-empty") then "GH_CONFIG_DIR" else empty end),
        (if $e.GITHUB_TOKEN != "" then "GITHUB_TOKEN not empty" else empty end),
        (if $e.GH_TOKEN != "" then "GH_TOKEN not empty" else empty end),
        (if $e.GH_REPO != "johnrclem/hashtracks-web" then "GH_REPO" else empty end),
        (if (($e.PATH // "") | split(":")[0]) != ($root + "/bin") then "PATH does not start with the shim" else empty end) ]
    | join(", ")' "$LOCAL")"
  [[ -z "$env_problems" ]] || problems+=("env: $env_problems")
fi

[[ -x "$ROOT/bin/gh" && -x "$ROOT/bin/mint-token.sh" ]] || problems+=("the gh shim or minter is missing")
[[ -r "$ROOT/.agent/config" ]] || problems+=("no .agent/config")
# gh keeps logins in hosts.yml; the empty config dir must never get one.
if [[ -s "$ROOT/.agent/gh-empty/hosts.yml" ]]; then
  problems+=("gh has a stored login in .agent/gh-empty")
fi
git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 && problems+=("the root is inside a git repository")

if ((${#problems[@]})); then
  (IFS='; '; echo "root-settings: DRIFT: ${problems[*]}")
  exit 1
fi
echo "root-settings: OK"
