#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  docker compose down --remove-orphans
}

trap cleanup EXIT

docker compose up --build --detach hapi-4309

for attempt in {1..30}; do
  if (echo > /dev/tcp/127.0.0.1/3000) >/dev/null 2>&1; then
    break
  fi

  if [ "$attempt" -eq 30 ]; then
    echo "hapi server did not become reachable on port 3000" >&2
    exit 1
  fi

  sleep 1
done

docker compose --profile load-test run --rm -T blazemeter
