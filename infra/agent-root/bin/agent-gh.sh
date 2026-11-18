#!/usr/bin/env bash
#
# agent-gh.sh — the `gh` every scheduled task runs (installed as <root>/bin/gh, first on PATH).
#
# Mints a fresh HashTracks Agent App token on every call and runs the real gh with it, so each run
# acts as the bot, never the owner. If minting fails it exits 97 and runs nothing. It also answers
# two calls an installation token can't:
#   gh api user [--jq .login]      the bot's login, as the identity preflight expects
#   gh auth git-credential get     the token as a git credential (the clones' credential helper)

set -uo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
BIN="$ROOT/bin"
REAL_GH="$(sed -n 's/^REAL_GH=//p' "$ROOT/.agent/config" 2>/dev/null | head -1)"

if ! token="$("$BIN/mint-token.sh")" || [[ -z "$token" ]]; then
  echo "agent-gh: couldn't mint a HashTracks Agent token, so gh will not run (docs/ops/system.md#identity)" >&2
  exit 97
fi
unset GITHUB_TOKEN
export GH_TOKEN="$token"

if [[ "${1:-}" == "api" && ( "${2:-}" == "user" || "${2:-}" == "/user" ) ]]; then
  login="$("$BIN/mint-token.sh" --login)" || exit 97
  if [[ " $* " == *" --jq .login "* ]]; then
    printf '%s\n' "$login"
  else
    printf '{"login":"%s","type":"Bot"}\n' "$login"
  fi
  exit 0
fi

if [[ "${1:-}" == "auth" && "${2:-}" == "git-credential" ]]; then
  if [[ "${3:-}" == "get" ]]; then
    cat >/dev/null # git's request; the answer doesn't depend on it
    printf 'protocol=https\nhost=github.com\nusername=x-access-token\npassword=%s\n' "$token"
  fi
  exit 0
fi

if [[ ! -x "$REAL_GH" || "$REAL_GH" -ef "${BASH_SOURCE[0]}" ]]; then
  echo "agent-gh: REAL_GH in $ROOT/.agent/config isn't the real gh (run install.sh)" >&2
  exit 97
fi
exec "$REAL_GH" "$@"
