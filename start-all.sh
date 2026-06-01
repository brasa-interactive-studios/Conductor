#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/.logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

load_node() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    nvm use 20 >/dev/null
  fi
}

resolve_claude_bin() {
  if [[ -n "${CLAUDE_CODE_BIN:-}" ]] && [[ -x "${CLAUDE_CODE_BIN}" ]]; then
    return 0
  fi

  local detected=""
  detected="$(command -v claude 2>/dev/null || true)"

  if [[ -z "$detected" ]] && [[ -x "$HOME/.local/bin/claude" ]]; then
    detected="$HOME/.local/bin/claude"
  fi

  if [[ -n "$detected" ]]; then
    export CLAUDE_CODE_BIN="$detected"
    echo "[start-all] CLAUDE_CODE_BIN=$CLAUDE_CODE_BIN"
  else
    echo "[start-all] Claude CLI not found; cloud Claude route may be unavailable"
  fi
}

is_port_open() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" | tail -n +2 | grep -q "."
    return $?
  fi
  return 1
}

start_service() {
  local name="$1"
  local cmd="$2"
  local port="$3"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  if [[ -f "$pid_file" ]]; then
    local old_pid
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
      echo "[start-all] $name already running (pid=$old_pid)"
      return 0
    fi
    rm -f "$pid_file"
  fi

  if is_port_open "$port"; then
    echo "[start-all] $name port $port already in use (existing process). Skipping start."
    return 0
  fi

  echo "[start-all] starting $name..."
  nohup bash -lc "cd '$ROOT_DIR' && $cmd" >"$log_file" 2>&1 &
  local pid=$!
  echo "$pid" >"$pid_file"

  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    echo "[start-all] $name started (pid=$pid, log=$log_file)"
  else
    echo "[start-all] failed to start $name. Check $log_file"
    rm -f "$pid_file"
    return 1
  fi
}

load_node
resolve_claude_bin

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[start-all] pnpm not found in PATH. Load nvm/node first."
  exit 1
fi

start_service "ai-server" "pnpm --filter @apps/ai-server dev" "8080"
start_service "control-panel" "pnpm --filter @apps/control-panel dev -- --host 0.0.0.0 --port 5173" "5173"

echo "[start-all] done"
echo "- ai-server: http://127.0.0.1:8080/health"
echo "- control-panel: http://127.0.0.1:5173"
