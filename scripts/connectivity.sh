#!/usr/bin/env bash
# Explicit opt-in diagnostic of this laptop's route only.
set -euo pipefail
if [[ ${1:-} != --check ]]; then
  echo 'No external request made. Use --check to test the laptop internet route.'
  exit 0
fi
if curl --noproxy '*' --connect-timeout 3 --max-time 5 --fail --silent --output /dev/null https://example.com/; then
  echo 'Laptop reached the internet. This says nothing about players mobile data.'
else
  echo 'Laptop could not reach the test URL. This does not prove players are offline.'
fi
