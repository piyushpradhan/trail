# Trail shell hook for bash/zsh.
# Source from your ~/.bashrc or ~/.zshrc:
#   source /path/to/trail-hook.sh

TRAIL_ENDPOINT="${TRAIL_ENDPOINT:-http://127.0.0.1:47123}"

_trail_post() {
  local path="$1"
  local body="$2"
  curl -fsS -X POST -H 'Content-Type: application/json' \
    --max-time 1 \
    "$TRAIL_ENDPOINT$path" -d "$body" >/dev/null 2>&1 || true
}

_trail_context() {
  local repo="" branch=""
  if command -v git >/dev/null 2>&1; then
    local top
    top=$(git rev-parse --show-toplevel 2>/dev/null)
    if [ -n "$top" ]; then
      repo=$(basename "$top")
      branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    fi
  fi
  local shell_name="${SHELL##*/}"
  printf '{"shell":"%s","cwd":"%s","pid":%d,"host":"%s","user":"%s","repo":"%s","branch":"%s"}' \
    "$shell_name" "$PWD" "$$" "$(hostname)" "$USER" "$repo" "$branch"
}

# Session start
_trail_post "/session/start" "$(_trail_context)"

# Session end via EXIT trap
_trail_session_end() {
  _trail_post "/session/end" "$(_trail_context)"
}
trap _trail_session_end EXIT

# Manual helpers
trail-task() {
  if [ -z "$1" ]; then
    echo "usage: trail-task <title> [tag1 tag2 ...]" >&2
    return 1
  fi
  local title="$1"; shift
  local tags="["
  local first=1
  for t in "$@"; do
    if [ $first -eq 1 ]; then tags="$tags\"$t\""; first=0
    else tags="$tags,\"$t\""; fi
  done
  tags="$tags]"
  _trail_post "/task" "{\"title\":\"$title\",\"tags\":$tags}"
}

trail-context() {
  _trail_post "/session/start" "$(_trail_context)"
}
