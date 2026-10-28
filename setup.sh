#!/bin/sh
# Run once (Mac/Linux): installs Flow Automator and adds it to Claude.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again."
  exit 1
fi
npm install --omit=dev --no-audit --no-fund && node setup.js
