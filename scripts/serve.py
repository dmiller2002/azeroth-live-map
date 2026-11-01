#!/usr/bin/env python3
"""Local, loopback-only preview. localhost supports browser screen sharing."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from pathlib import Path
from model_assets import MODEL_PREFIX, fetch_model_asset
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8765)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent / 'dist'
class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith(MODEL_PREFIX):
            status, data, mime = fetch_model_asset(self.path)
            self.send_response(status); self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'public, max-age=86400' if status == 200 else 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff'); self.end_headers(); self.wfile.write(data)
        else:
            super().do_GET()
handler = partial(Handler, directory=str(root))
server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
print(f'Drunks Azeroth UI: http://localhost:{args.port}', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    server.server_close()
