#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

prepare_port() {
  local port="$1"
  local service_name="$2"
  local listeners pid process_cwd
  local epoch_pids=()
  local foreign_pids=()
  command -v lsof >/dev/null 2>&1 || return 0
  listeners="$(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
  [[ -z "$listeners" ]] && return 0
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    process_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    if [[ "$process_cwd" == "$PROJECT_ROOT" || "$process_cwd" == "$PROJECT_ROOT/"* ]]; then
      epoch_pids+=("$pid")
    else
      foreign_pids+=("$pid")
    fi
  done <<< "$listeners"

  if [[ ${#foreign_pids[@]} -gt 0 ]]; then
    echo "$service_name cannot start because TCP port $port is already in use:" >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2
    echo "The listener is not owned by this Epoch workspace and will not be terminated." >&2
    exit 1
  fi

  if [[ ${#epoch_pids[@]} -gt 0 ]]; then
    echo "Stopping stale $service_name process(es) on port $port: ${epoch_pids[*]}"
    kill "${epoch_pids[@]}" 2>/dev/null || true
    for _ in {1..20}; do
      lsof -t -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || return 0
      sleep 0.1
    done
    listeners="$(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
    [[ -z "$listeners" ]] && return 0
    epoch_pids=()
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      process_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
      if [[ "$process_cwd" != "$PROJECT_ROOT" && "$process_cwd" != "$PROJECT_ROOT/"* ]]; then
        echo "$service_name port $port was acquired by a non-Epoch process; refusing to terminate it." >&2
        exit 1
      fi
      epoch_pids+=("$pid")
    done <<< "$listeners"
    kill -9 "${epoch_pids[@]}" 2>/dev/null || true
    for _ in {1..20}; do
      lsof -t -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || return 0
      sleep 0.1
    done
    echo "$service_name port $port could not be released." >&2
    exit 1
  fi
}

stop_stale_epoch_processes() {
  local process_pattern="$1"
  local service_name="$2"
  local pid process_cwd
  local epoch_pids=()
  command -v pgrep >/dev/null 2>&1 || return 0
  while IFS= read -r pid; do
    [[ -z "$pid" || "$pid" == "$$" ]] && continue
    process_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    if [[ "$process_cwd" == "$PROJECT_ROOT" || "$process_cwd" == "$PROJECT_ROOT/"* ]]; then
      epoch_pids+=("$pid")
    fi
  done < <(pgrep -f "$process_pattern" 2>/dev/null || true)
  if [[ ${#epoch_pids[@]} -gt 0 ]]; then
    echo "Stopping stale $service_name process(es): ${epoch_pids[*]}"
    kill "${epoch_pids[@]}" 2>/dev/null || true
  fi
}

install_brew_package() {
  local package_name="$1"
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required to install missing dependency: $package_name" >&2
    echo "Install Homebrew from https://brew.sh, then rerun this command." >&2
    exit 1
  fi
  echo "Installing missing dependency: $package_name..."
  brew install "$package_name"
}

if ! command -v pnpm >/dev/null 2>&1; then
  install_brew_package pnpm
fi

if ! command -v uv >/dev/null 2>&1; then
  install_brew_package uv
fi

prepare_port 3000 "Epoch Web"
prepare_port 8000 "Epoch Analytics"
# Scheduler has no listening port, so it needs its own workspace-scoped stale
# process check. This prevents a previous code version from consuming newly
# migrated jobs before the current Scheduler starts.
stop_stale_epoch_processes "node --import tsx scripts/scheduler\\.ts" "Epoch Scheduler"

if [[ ! -d node_modules ]]; then
  echo "Installing Node dependencies..."
  pnpm install --frozen-lockfile
fi

echo "Synchronizing Python dependencies..."
uv sync --locked --project services/analytics

if [[ -z "${DATABASE_URL:-}" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    if [[ "$(uname -s)" != "Darwin" ]]; then
      echo "Docker is required to start PostgreSQL. Install Docker or set DATABASE_URL." >&2
      exit 1
    fi
    if ! command -v brew >/dev/null 2>&1; then
      echo "Homebrew is required to install Docker Desktop automatically." >&2
      echo "Install Docker manually or set DATABASE_URL to an existing PostgreSQL database." >&2
      exit 1
    fi
    echo "Installing Docker Desktop..."
    brew install --cask docker
  fi

  if ! docker info >/dev/null 2>&1; then
    if [[ "$(uname -s)" != "Darwin" ]]; then
      echo "Docker is installed but its daemon is not running." >&2
      exit 1
    fi
    echo "Starting Docker Desktop..."
    open -a Docker
    docker_ready=0
    for _ in {1..60}; do
      if docker info >/dev/null 2>&1; then
        docker_ready=1
        break
      fi
      sleep 1
    done
    if [[ "$docker_ready" -ne 1 ]]; then
      echo "Docker Desktop did not become ready within 60 seconds." >&2
      exit 1
    fi
  fi

  echo "Starting local PostgreSQL..."
  docker compose up -d postgres
  export DATABASE_URL="postgresql://epoch:epoch-local-only@127.0.0.1:5432/epoch"

  postgres_ready=0
  for _ in {1..30}; do
    if docker compose exec -T postgres pg_isready -U epoch >/dev/null 2>&1; then
      postgres_ready=1
      break
    fi
    sleep 1
  done
  if [[ "$postgres_ready" -ne 1 ]]; then
    echo "PostgreSQL did not become ready within 30 seconds." >&2
    exit 1
  fi
fi

export ANALYTICS_URL="${ANALYTICS_URL:-http://127.0.0.1:8000}"

pids=()
cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ ${#pids[@]} -gt 0 ]]; then
    echo
    echo "Stopping Epoch development services..."
    kill "${pids[@]}" >/dev/null 2>&1 || true
    wait "${pids[@]}" >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

echo "Starting Analytics for startup calculations..."
pnpm analytics:dev &
pids+=("$!")
analytics_ready=0
for _ in {1..60}; do
  if curl -fsS "$ANALYTICS_URL/health" >/dev/null 2>&1; then
    analytics_ready=1
    break
  fi
  sleep 0.5
done
if [[ "$analytics_ready" -ne 1 ]]; then
  echo "Analytics did not become ready within 30 seconds." >&2
  exit 1
fi

echo "Applying database migrations..."
pnpm db:migrate
echo "Registering the existing private baseline when available..."
pnpm baseline:import -- --optional
echo "Ensuring the unified daily data pipeline is fresh..."
pnpm daily:data:ensure

echo "Starting Web and Scheduler..."
pnpm dev &
pids+=("$!")
pnpm scheduler &
pids+=("$!")

echo "Epoch is starting at http://localhost:3000 (Ctrl-C stops all app processes)."

while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      status=0
      wait "$pid" || status=$?
      echo "A development service exited with status $status." >&2
      exit "$status"
    fi
  done
  sleep 1
done
