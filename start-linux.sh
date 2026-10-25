#!/bin/bash
# Run to play The 12th Tide (Linux): ./start-linux.sh
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then exec python3 serve.py
elif command -v npx >/dev/null 2>&1; then (sleep 2; xdg-open "http://127.0.0.1:8080/" >/dev/null 2>&1) & exec npx --yes http-server play -p 8080 -a 127.0.0.1 -c-1
else echo "The 12th Tide needs Python 3 or Node.js to run its little local server."; fi
