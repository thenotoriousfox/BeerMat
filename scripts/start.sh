#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
if [[ -z ${HOST_KEY:-} ]]; then
  read -r -s -p 'Quizmaster key (12+ characters): ' HOST_KEY
  printf '\n'
  export HOST_KEY
fi
umask 077
exec node server.js
