#!/usr/bin/env bash
set -euo pipefail

docker compose --profile load-test up --build --abort-on-container-exit
