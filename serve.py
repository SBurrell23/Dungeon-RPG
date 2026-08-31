"""Tiny static server for Dungeon RPG.

ES modules will not load from file:// - the game has to be served over http.
Python's stock http.server is fine for that, except it lets the browser cache
modules, which makes editing the game maddening. This adds no-store headers and
the correct MIME type for .js/.mjs.

    python serve.py [port]        # default 8123
"""

import http.server
import sys
import webbrowser
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".png": "image/png",
        ".mp3": "audio/mpeg",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Always revalidate: editing a module and hitting reload should show the
        # edit, not a stale copy from the disk cache.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quieter: only report problems, not every sprite fetch.
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    # Threaded: the game pulls ~430 sprite sheets on startup and a single
    # threaded server serialises them into a very slow (sometimes stalled) load.
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}/"
        print(f"Dungeon RPG serving at {url}  (Ctrl+C to stop)", flush=True)
        if "--no-browser" not in sys.argv:
            try:
                webbrowser.open(url)
            except Exception:
                pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
