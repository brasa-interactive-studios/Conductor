#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$ROOT_DIR/.run"

stop_pid_file() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"

  if [[ ! -f "$pid_file" ]]; then
    echo "[stop-all] $name pid file not found"
    return 0
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"

  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo "[stop-all] $name pid file empty, cleaned"
    return 0
  fi

  if kill -0 "$pid" 2>/dev/null; then
    echo "[stop-all] stopping $name (pid=$pid)..."
    kill "$pid" 2>/dev/null || true

    for _ in {1..20}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done

    if kill -0 "$pid" 2>/dev/null; then
      echo "[stop-all] force killing $name (pid=$pid)"
      kill -9 "$pid" 2>/dev/null || true
    fi
  else
    echo "[stop-all] $name not running (stale pid=$pid)"
  fi

  rm -f "$pid_file"
}

kill_port() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

  local pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null | tr '\n' ' ' || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo "[stop-all] stopping processes on port $port: $pids"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
}

stop_pid_file "ai-server"
stop_pid_file "control-panel"

kill_port "8080"
kill_port "5173"

echo "[stop-all] done"
