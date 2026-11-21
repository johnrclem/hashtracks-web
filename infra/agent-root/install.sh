#!/usr/bin/env bash
#
# install.sh — set up the agent root, ~/Developer/hashtracks-agents/, where every HashTracks
# scheduled task starts (docs/ops/system.md#identity). The owner runs it once from a checkout of
# main, and again after any change to this folder or to the repo's .claude/settings.json.
#
#   bash infra/agent-root/install.sh --app-id <id> --installation-id <id> --key <pem> [--root <dir>]
#
# It:
#   1. refuses a root inside a git repository (a task's reset must never reach it);
#   2. copies the gh shim and the token minter into <root>/bin (bin/gh is the shim), copies the key
#      to <root>/.agent/app.pem, and writes <root>/.agent/config (App id, installation id, key path,
#      the real gh, the bot login);
#   3. checks it can mint a token and read the bot's login;
#   4. writes <root>/.claude/settings.local.json: an env block (an empty GH_CONFIG_DIR, empty
#      GITHUB_TOKEN and GH_TOKEN, GH_REPO, PATH with the shim first) plus the repo's
#      .claude/settings.json permissions merged with settings.extra.json;
#   5. points each task clone that exists (fixer, implementer, research) at the bot: an HTTPS
#      remote, the shim as git's only credential helper, and the bot as commit author.
#
# Prints no secret. Re-running is safe. Needs bash, jq, openssl and curl (all ship with macOS).

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SRC/../.." && pwd)"
ROOT="$HOME/Developer/hashtracks-agents"
APP_ID="" INSTALLATION_ID="" KEY=""
CLONES=("$HOME/Developer/hashtracks-audit-fixer" "$HOME/Developer/hashtracks-implementer" "$HOME/Developer/hashtracks-research")

die() { echo "install: $*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --app-id) APP_ID="${2:-}"; shift 2 ;;
    --installation-id) INSTALLATION_ID="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;;
    --root) ROOT="${2:-}"; shift 2 ;;
    *) sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 64 ;;
  esac
done
[[ "$APP_ID" =~ ^[0-9]+$ ]] || die "--app-id must be the App's numeric id"
[[ "$INSTALLATION_ID" =~ ^[0-9]+$ ]] || die "--installation-id must be a number (github.com/settings/installations/<id>)"
[[ -r "$KEY" ]] || die "--key must be the App's private key file"
for tool in jq openssl curl git; do command -v "$tool" >/dev/null || die "$tool is missing"; done

# 1. Never inside a repository.
mkdir -p "$ROOT"
ROOT="$(cd "$ROOT" && pwd)"
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then die "$ROOT is inside a git repository; pick a folder outside every clone"; fi

# PATH without the root's own bin (so a re-install finds the real gh) and without fnm's per-shell
# directories, which vanish when that shell exits. When Node comes from one of those, keep the
# directory it links to (fnm's installed version) instead.
NODE_DIR=""
NODE_BIN="$(command -v node || true)"
if [[ "$NODE_BIN" == *fnm_multishells* ]]; then NODE_DIR="$(readlink -f "$(dirname "$NODE_BIN")")"; fi
# Any directory whose gh is an agent-root shim goes too (this root's, or an older install's).
# The trailing newline matters: `read` drops a last line without one, which lost the last PATH
# entry (Homebrew's, on the owner's Mac, so node and gh went missing).
BASE_PATH="$(printf '%s\n' "$PATH" | tr ':' '\n' | while IFS= read -r dir; do
  [[ -z "$dir" || "$dir" == *fnm_multishells* ]] && continue
  [[ "$(basename "$(readlink -f "$dir/gh" 2>/dev/null)")" == agent-gh.sh ]] && continue
  printf '%s\n' "$dir"
done | paste -sd: -)"
if [[ -n "$NODE_DIR" && ":$BASE_PATH:" != *":$NODE_DIR:"* ]]; then
  BASE_PATH="$BASE_PATH:$NODE_DIR"
fi
# Where a fixed tool name (node, npx, gh) resolves on BASE_PATH.
on_base_path() {
  local tool="$1"
  env PATH="$BASE_PATH" /bin/sh -c "command -v $tool"
}
{ on_base_path node && on_base_path npx; } >/dev/null \
  || die "node and npx must be on PATH without fnm's per-shell directories (install Node with Homebrew, or set an fnm default)"

# 2. Scripts, the key and the config.
REAL_GH="$(on_base_path gh || true)"
[[ -n "$REAL_GH" && "$(basename "$(readlink -f "$REAL_GH")")" != agent-gh.sh ]] \
  || die "couldn't find the real gh on PATH (brew install gh)"
[[ -x "$REAL_GH" ]] || die "gh isn't installed (brew install gh)"
mkdir -p "$ROOT/bin" "$ROOT/.agent/gh-empty" "$ROOT/.claude"
chmod 700 "$ROOT/.agent"
install -m 755 "$SRC/bin/agent-gh.sh" "$SRC/bin/mint-token.sh" "$SRC/bin/check-root.sh" "$ROOT/bin/"
ln -sf agent-gh.sh "$ROOT/bin/gh"
KEY_FILE="$ROOT/.agent/app.pem"
install -m 600 "$KEY" "$KEY_FILE"
umask 077
write_config() {
  printf 'APP_ID=%s\nINSTALLATION_ID=%s\nKEY_FILE=%s\nREAL_GH=%s\nBOT_LOGIN=%s\nCLONES=%s\n' \
    "$APP_ID" "$INSTALLATION_ID" "$KEY_FILE" "$REAL_GH" "${1:-}" "$(IFS=:; echo "${CLONES[*]}")" >"$ROOT/.agent/config"
}
write_config

# 3. Prove it works before anything points at it.
"$ROOT/bin/mint-token.sh" >/dev/null || die "couldn't mint a token: check the ids, the key, and that the App is installed on the repository"
BOT="$("$ROOT/bin/mint-token.sh" --login)" || die "couldn't read the App's login"
write_config "$BOT"
BOT_ID="$(curl -fsS --proto '=https' --proto-redir '=https' --tlsv1.2 --max-time 20 "https://api.github.com/users/$(jq -rn --arg l "$BOT" '$l|@uri')" | jq -er .id)" || die "couldn't look up $BOT"
echo "Agent App OK: acts as $BOT"

# 4. Settings: the env block, and the repo's permissions plus this folder's extras.
AGENT_PATH="$ROOT/bin:$BASE_PATH"
jq -n \
  --slurpfile repo "$REPO/.claude/settings.json" \
  --slurpfile extra "$SRC/settings.extra.json" \
  --arg ghdir "$ROOT/.agent/gh-empty" --arg path "$AGENT_PATH" --arg agentdir "/$ROOT/.agent/**" '
  # The file tools never read or edit the App key or config (absolute path: "//" + ROOT).
  def rootRules(k): if k == "deny" then ["Read(\($agentdir))", "Edit(\($agentdir))"] else [] end;
  def merged(k): ((($repo[0].permissions[k]) // []) + (($extra[0].permissions[k]) // []) + rootRules(k)) | unique;
  {
    env: {
      GH_CONFIG_DIR: $ghdir,
      GITHUB_TOKEN: "",
      GH_TOKEN: "",
      GH_REPO: "johnrclem/hashtracks-web",
      GH_NO_UPDATE_NOTIFIER: "1",
      GH_PROMPT_DISABLED: "1",
      PATH: $path
    },
    permissions: { allow: merged("allow"), deny: merged("deny") }
  }' >"$ROOT/.claude/settings.local.json"
echo "Wrote $ROOT/.claude/settings.local.json"

# 5. Each task clone pushes and commits as the bot.
for clone in "${CLONES[@]}"; do
  if [[ ! -d "$clone/.git" ]]; then echo "skip: $clone (not a clone yet)"; continue; fi
  git -C "$clone" remote set-url origin https://github.com/johnrclem/hashtracks-web.git
  git -C "$clone" config --local --unset-all remote.origin.pushurl 2>/dev/null || true
  # An empty helper first clears any inherited one (the keychain), so git asks only the shim.
  git -C "$clone" config --local --unset-all credential.helper 2>/dev/null || true
  git -C "$clone" config --local --add credential.helper ''
  git -C "$clone" config --local --add credential.helper "!$ROOT/bin/gh auth git-credential"
  git -C "$clone" config --local user.name "$BOT"
  git -C "$clone" config --local user.email "${BOT_ID}+${BOT}@users.noreply.github.com"
  echo "clone: $clone now pushes and commits as $BOT"
done

# 6. Claude Code starts each session's shell from a snapshot of the user's shell, and the snapshot
#    sets PATH itself, so the settings' PATH (shim first) never applies. The settings' GH_CONFIG_DIR
#    does. So a dispatcher goes where the snapshot's PATH finds it before Homebrew: ~/.local/bin/gh.
#    It runs this root's shim when GH_CONFIG_DIR is an agent root's empty config, else the real gh.
DISPATCHER="$HOME/.local/bin/gh"
if [[ -e "$DISPATCHER" ]] && ! grep -q 'HashTracks gh dispatcher' "$DISPATCHER" 2>/dev/null; then
  die "$DISPATCHER exists and isn't the HashTracks dispatcher; move it aside and re-run"
fi
mkdir -p "$HOME/.local/bin"
install -m 755 "$SRC/bin/gh-dispatcher.sh" "$DISPATCHER"
echo "Installed the gh dispatcher at $DISPATCHER"

"$ROOT/bin/check-root.sh" "$REPO/.claude/settings.json" || true
cat <<EOF

Next (docs/ops/system.md#identity):
  - Re-point each of the six scheduled tasks' folder to $ROOT in the Claude desktop app.
  - Wait for each to log "login=$BOT" on a real scheduled run before switching the preflight to STOP.
EOF
