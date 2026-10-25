#!/bin/bash
# Double-click to play The 12th Tide (macOS). If macOS says it can't be opened, right-click it and choose Open.
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then exec python3 serve.py
elif command -v npx >/dev/null 2>&1; then (sleep 2; open "http://127.0.0.1:8080/") & exec npx --yes http-server play -p 8080 -a 127.0.0.1 -c-1
else echo "The 12th Tide needs Python 3 (python.org) or Node.js (nodejs.org) to run its little local server."; read -n 1 -s -r -p "Press any key to close."; fi
