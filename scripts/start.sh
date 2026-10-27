#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
if [[ -z ${HOST_KEY:-} ]]; then
  read -r -s -p 'Quizmaster key (12+ characters): ' HOST_KEY
  printf '\n'
  export HOST_KEY
fi
if [[ ${1:-} == --hotspot ]]; then
  # Answer only on this laptop and the quiz Wi-Fi, not on any other network the laptop joins.
  export ALLOWED_ADDRESSES=127.0.0.1,::1,10.42.0.1
fi
umask 077
exec node --disable-warning=ExperimentalWarning server/server.js
