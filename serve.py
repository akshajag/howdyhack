"""Serve The 12th Tide on this computer and open it in the browser.

    python3 serve.py          (macOS / Linux)
    py serve.py               (Windows)

Serves the `play` folder at http://127.0.0.1:8080 (or the next free port). A local address counts as a secure
origin, so the hand camera works. Close the window or press Ctrl+C to stop. Needs Python 3.7+ and nothing else.
"""
import http.server
import os
import socket
import sys
import threading
import webbrowser

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'play')


class Handler(http.server.SimpleHTTPRequestHandler):
    # set the types explicitly: some systems map .js to text/plain, which browsers refuse for module scripts
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
                      '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
                      '.bin': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png',
                      '.jpg': 'image/jpeg', '.webp': 'image/webp'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass


def main():
    if not os.path.isfile(os.path.join(ROOT, 'index.html')):
        sys.exit('Could not find the "play" folder next to serve.py.')
    first = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    for port in range(first, first + 20):
        try:
            server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
            break
        except OSError:
            continue
    else:
        sys.exit(f'No free port between {first} and {first + 19}.')
    url = f'http://127.0.0.1:{port}/'
    print(f'\n  The 12th Tide is running at {url}\n  (keep this window open while you play; close it or press Ctrl+C to stop)\n', flush=True)
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
