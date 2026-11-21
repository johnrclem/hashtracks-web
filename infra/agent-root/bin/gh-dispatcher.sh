#!/bin/sh
# HashTracks gh dispatcher (infra/agent-root): agent-root sessions get the App shim, everyone else the real gh.
case "${GH_CONFIG_DIR:-}" in
  */.agent/gh-empty)
    shim="${GH_CONFIG_DIR%/.agent/gh-empty}/bin/gh"
    [ -x "$shim" ] || { echo "gh dispatcher: agent session but no shim at $shim; refusing" >&2; exit 97; }
    exec "$shim" "$@" ;;
  *) ;; # anyone else: the real gh, below
esac
for real in /opt/homebrew/bin/gh /usr/local/bin/gh; do [ -x "$real" ] && exec "$real" "$@"; done
echo "gh dispatcher: real gh not found" >&2; exit 127
