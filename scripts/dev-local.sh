#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

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

echo "Applying database migrations..."
pnpm db:migrate
echo "Registering the existing private baseline when available..."
pnpm baseline:import -- --optional

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

echo "Starting Web, Scheduler, and Analytics..."
pnpm dev &
pids+=("$!")
pnpm scheduler &
pids+=("$!")
pnpm analytics:dev &
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
