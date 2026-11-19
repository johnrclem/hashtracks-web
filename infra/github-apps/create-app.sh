#!/usr/bin/env bash
#
# create-app.sh — create one of the HashTracks GitHub Apps from its manifest (GitHub's manifest
# flow), then save its private key without printing it. The owner runs this; see README.md here.
#
#   bash infra/github-apps/create-app.sh open infra/github-apps/hashtracks-server.json
#       Opens a local page whose button sends the manifest to GitHub. Confirm the App there.
#       GitHub then redirects to https://www.hashtracks.xyz/?code=<code>; copy the code.
#   bash infra/github-apps/create-app.sh convert <code> <key-file>
#       Exchanges the one-time code (valid one hour) for the App. Writes the private key to
#       <key-file> (mode 600) and prints only the App's id, slug and bot login.
#
# Needs curl and jq (both ship with macOS). Exit codes: 0 done, 1 GitHub or file error, 64 usage.

set -euo pipefail

usage() {
  sed -n '3,13p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 64
}

case "${1:-}" in
  open)
    manifest="${2:-}"
    [[ -f "$manifest" ]] || usage
    jq -e '.name and .default_permissions' "$manifest" >/dev/null || { echo "not a GitHub App manifest: $manifest" >&2; exit 1; }
    page="$(mktemp -d)/create-github-app.html"
    # Everything that goes into the page is HTML-escaped.
    html_escape() { sed -e 's/&/\&amp;/g' -e 's/"/\&quot;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
    value="$(jq -c . "$manifest" | html_escape)"
    name="$(jq -r .name "$manifest" | html_escape)"
    file="$(basename "$manifest" | html_escape)"
    cat >"$page" <<HTML
<!doctype html>
<meta charset="utf-8">
<title>Create the ${name} GitHub App</title>
<form action="https://github.com/settings/apps/new" method="post">
  <input type="hidden" name="manifest" value="${value}">
  <p>Creates the <b>${name}</b> GitHub App on your account, from <code>${file}</code>.</p>
  <button type="submit">Create on GitHub</button>
</form>
HTML
    open "$page" 2>/dev/null || echo "Open this file in a browser: $page"
    ;;
  convert)
    code="${2:-}"
    key_file="${3:-}"
    [[ "$code" =~ ^[A-Za-z0-9_-]{8,128}$ && -n "$key_file" ]] || usage
    [[ -e "$key_file" ]] && { echo "refusing to overwrite $key_file" >&2; exit 1; }
    umask 077
    # The response holds the private key and the App's secrets: keep it out of the terminal.
    response="$(curl -fsS --proto '=https' --proto-redir '=https' --tlsv1.2 -X POST -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/app-manifests/${code}/conversions")" || { echo "GitHub refused the code (used, or older than an hour?)" >&2; exit 1; }
    # Write the key whole or not at all, so a failed run doesn't leave an empty file in the way.
    tmp_key="$(mktemp "${key_file}.XXXXXX")"
    if ! printf '%s' "$response" | jq -er .pem >"$tmp_key"; then
      rm -f "$tmp_key"
      echo "GitHub's response had no private key" >&2
      exit 1
    fi
    chmod 600 "$tmp_key"
    mv "$tmp_key" "$key_file"
    printf '%s' "$response" | jq '{app_id: .id, slug, bot_login: (.slug + "[bot]"), settings: .html_url}'
    echo "Private key saved to $key_file (mode 600). Next: install the App on johnrclem/hashtracks-web only." >&2
    ;;
  *)
    usage
    ;;
esac
