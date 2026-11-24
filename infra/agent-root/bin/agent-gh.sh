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
conf() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ROOT/.agent/config" 2>/dev/null | head -1
}
REAL_GH="$(conf REAL_GH)"

# git's `store` and `erase` need no answer, so they need no token.
if [[ "${1:-}" == "auth" && "${2:-}" == "git-credential" && "${3:-}" != "get" ]]; then
  cat >/dev/null
  exit 0
fi

if ! token="$("$BIN/mint-token.sh")" || [[ -z "$token" ]]; then
  echo "agent-gh: couldn't mint a HashTracks Agent token, so gh will not run (docs/ops/system.md#identity)" >&2
  exit 97
fi
unset GITHUB_TOKEN
export GH_TOKEN="$token"

# The mint above proves the key and the installation; install.sh recorded the login GitHub gave it.
# `gh api user` (or `/user`) in any argument order, with `.login` asked for as --jq/-q, with or
# without "=", or not at all. The identity preflight (docs/ops/system.md#identity) uses
# `gh api user --jq .login`; agent-root.test.ts pins these forms.
asks_user=0
asks_login=0
prev=""
for arg in "$@"; do
  case "$arg" in
    user | /user) [[ "$prev" == --jq || "$prev" == -q ]] || asks_user=1 ;;
    --jq=.login | -q=.login) asks_login=1 ;;
    .login) [[ "$prev" == --jq || "$prev" == -q ]] && asks_login=1 ;;
    *) ;; # any other argument changes nothing
  esac
  prev="$arg"
done
if [[ "${1:-}" == "api" ]] && ((asks_user)); then
  login="$(conf BOT_LOGIN)"
  [[ -n "$login" ]] || { echo "agent-gh: no BOT_LOGIN in $ROOT/.agent/config (run install.sh)" >&2; exit 97; }
  if ((asks_login)); then
    printf '%s\n' "$login"
  else
    printf '{"login":"%s","type":"Bot"}\n' "$login"
  fi
  exit 0
fi

if [[ "${1:-}" == "auth" && "${2:-}" == "git-credential" ]]; then
  cat >/dev/null # git's request; the answer doesn't depend on it
  printf 'protocol=https\nhost=github.com\nusername=x-access-token\npassword=%s\n' "$token"
  exit 0
fi

# The dispatcher sends agent sessions straight back here, so it can never be the real gh.
if [[ ! -x "$REAL_GH" || "$REAL_GH" -ef "${BASH_SOURCE[0]}" ]] || grep -q 'HashTracks gh dispatcher' "$REAL_GH" 2>/dev/null; then
  echo "agent-gh: REAL_GH in $ROOT/.agent/config isn't the real gh (run install.sh)" >&2
  exit 97
fi
exec "$REAL_GH" "$@"
