#!/usr/bin/env bash
#
# mint-token.sh — the HashTracks Agent App's credentials, minted fresh on every call.
#
#   mint-token.sh           prints a new installation token (valid one hour, this repository only)
#   mint-token.sh --login   prints the App's bot login, "<slug>[bot]", as GitHub reports it
#
# Exits non-zero, printing nothing on stdout, if anything fails: a missing config or key, a bad key,
# or GitHub refusing. Callers (the gh shim, git) then stop instead of falling back to the owner.
# Needs bash, openssl, curl and jq, all of which ship with macOS. Config: <root>/.agent/config,
# written by install.sh (APP_ID, INSTALLATION_ID, KEY_FILE).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="$ROOT/.agent/config"
die() { echo "mint-token: $*" >&2; exit 1; }

[[ -r "$CONF" ]] || die "no config at $CONF (run install.sh)"
conf() { sed -n "s/^$1=//p" "$CONF" | head -1; }
APP_ID="$(conf APP_ID)"
INSTALLATION_ID="$(conf INSTALLATION_ID)"
KEY_FILE="$(conf KEY_FILE)"
[[ "$APP_ID" =~ ^[0-9]+$ ]] || die "APP_ID in $CONF isn't a number"
[[ "$INSTALLATION_ID" =~ ^[0-9]+$ ]] || die "INSTALLATION_ID in $CONF isn't a number"
[[ -r "$KEY_FILE" ]] || die "can't read the App's private key ($KEY_FILE)"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
now="$(date +%s)"
header="$(printf '%s' '{"alg":"RS256","typ":"JWT"}' | b64url)"
payload="$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$((now - 60))" "$((now + 540))" "$APP_ID" | b64url)"
signature="$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -sign "$KEY_FILE" -binary | b64url)" || die "couldn't sign with the App's key"
jwt="$header.$payload.$signature"

api() {
  curl -fsS --max-time 20 -H "Authorization: Bearer $jwt" -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' "$@"
}

if [[ "${1:-}" == "--login" ]]; then
  slug="$(api https://api.github.com/app | jq -er .slug)" || die "GitHub refused the App's key"
  printf '%s[bot]\n' "$slug"
  exit 0
fi

token="$(api -X POST -d '{"repositories":["hashtracks-web"]}' \
  "https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens" | jq -er .token)" \
  || die "GitHub wouldn't mint an installation token"
printf '%s\n' "$token"
