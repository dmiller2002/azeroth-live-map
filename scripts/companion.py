#!/usr/bin/env python3
"""Open Azeroth Live Map in a separate Chromium window with normal capture consent."""
import argparse
import fcntl
import hashlib
import hmac
from http import HTTPStatus
from http.client import HTTPConnection, HTTPException
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
from urllib.parse import unquote, urlsplit

APP = 'azeroth-live-map'
DIST = Path(__file__).resolve().parent.parent / 'dist'
PORT = 8766
STATE = Path.home() / '.local/state' / APP
PROFILE = Path.home() / '.local/share' / APP / 'browser-profile'
MARKER = '/__azeroth_companion__'
EXTENSIONS = {'.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.zip', '.woff', '.woff2', '.txt'}


def identity(root):
    return hashlib.sha256(os.fsencode(root.resolve())).hexdigest()


def signing_key(state):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = state / 'server.key'
    try:
        fd = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, 'wb') as output:
            output.write(secrets.token_bytes(32))
    data = key.read_bytes()
    if len(data) != 32:
        raise RuntimeError('The local server identity file is damaged; check ' + str(key))
    return data


def proof(key, root_id, challenge):
    return hmac.new(key, (root_id + ':' + challenge).encode(), hashlib.sha256).hexdigest()


def make_server(root, port, key):
    root = root.resolve()
    root_id = identity(root)
    if not (root / 'index.html').is_file():
        raise RuntimeError('The app files are missing. Reinstall Azeroth Live Map.')

    class Handler(BaseHTTPRequestHandler):
        server_version = 'AzerothLiveMap'
        sys_version = ''

        def log_message(self, *_):
            pass

        def respond(self, status, data=b'', content_type='text/plain; charset=utf-8', head=False):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.end_headers()
            if not head:
                self.wfile.write(data)

        def do_GET(self, head=False):
            # Host validation also prevents an unrelated website using DNS rebinding.
            actual_port = self.server.server_address[1]
            if self.headers.get('Host', '') not in {f'localhost:{actual_port}', f'127.0.0.1:{actual_port}'}:
                self.respond(HTTPStatus.FORBIDDEN, b'Forbidden', head=head); return
            request = urlsplit(self.path)
            if request.scheme or request.netloc:
                self.respond(HTTPStatus.BAD_REQUEST, b'Invalid request', head=head); return
            if request.path == MARKER:
                payload = {'app': APP, 'version': 1, 'installation': root_id}
                challenge = self.headers.get('X-ALM-Challenge', '')
                if re.fullmatch(r'[a-f0-9]{64}', challenge):
                    payload['proof'] = proof(key, root_id, challenge)
                self.respond(HTTPStatus.OK, json.dumps(payload).encode(), 'application/json', head); return
            decoded = unquote(request.path)
            parts = decoded.lstrip('/').split('/')
            if '\\' in decoded or '\0' in decoded or any(p.startswith('.') for p in parts if p):
                self.respond(HTTPStatus.NOT_FOUND, b'Not found', head=head); return
            target = (root / ('index.html' if decoded == '/' else decoded.lstrip('/'))).resolve()
            if not target.is_relative_to(root) or not target.is_file() or target.suffix.lower() not in EXTENSIONS:
                self.respond(HTTPStatus.NOT_FOUND, b'Not found', head=head); return
            try:
                data = target.read_bytes()
            except OSError:
                self.respond(HTTPStatus.NOT_FOUND, b'Not found', head=head); return
            mime = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
            self.respond(HTTPStatus.OK, data, mime, head)

        def do_HEAD(self):
            self.do_GET(head=True)

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    return server


def ready(port, root, key):
    """A signed fresh challenge rejects unrelated services, even with a similar page."""
    challenge = secrets.token_hex(32)
    connection = HTTPConnection('127.0.0.1', port, timeout=0.6)
    try:
        connection.request('GET', MARKER, headers={'X-ALM-Challenge': challenge})
        response = connection.getresponse()
        data = json.loads(response.read(4096)) if response.status == 200 else {}
        return (isinstance(data, dict) and data.get('app') == APP and data.get('version') == 1
                and data.get('installation') == identity(root)
                and hmac.compare_digest(str(data.get('proof', '')), proof(key, identity(root), challenge)))
    except (OSError, ValueError, HTTPException):
        return False
    finally:
        connection.close()


def occupied(port):
    with socket.socket() as probe:
        probe.settimeout(0.3)
        return probe.connect_ex(('127.0.0.1', port)) == 0


def ensure_server(port, state):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / 'startup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        key = signing_key(state)
        if ready(port, DIST, key):
            return
        if occupied(port):
            raise RuntimeError(f'Port {port} belongs to another service. Nothing was opened or stopped.')
        log = state / 'server.log'
        if log.exists() and log.stat().st_size > 1_000_000:
            log.replace(state / 'server.previous.log')
        with log.open('a') as output:
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--serve', '--port', str(port), '--state-dir', str(state)],
                                     stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(50):
            if ready(port, DIST, key):
                return
            if child.poll() is not None:
                break
            time.sleep(0.1)
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill(); child.wait()
        raise RuntimeError('The local map server could not start. See ' + str(log))


def browser_binary():
    for name in ('chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome', 'chrome'):
        if path := shutil.which(name):
            return path
    raise RuntimeError('Install Chromium or Google Chrome, then open Azeroth Live Map again.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=PORT)
    parser.add_argument('--state-dir', type=Path, default=STATE, help=argparse.SUPPRESS)
    parser.add_argument('--serve', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--no-browser', action='store_true', help='Start or check the local server without opening a window')
    parser.add_argument('--notify', action='store_true', help='Show desktop notifications for startup errors')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        raise RuntimeError('Use an unprivileged port between 1024 and 65535.')
    if args.serve:
        server = make_server(DIST, args.port, signing_key(args.state_dir))
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return
    browser = None if args.no_browser else browser_binary()
    ensure_server(args.port, args.state_dir)
    url = f'http://localhost:{args.port}/?app=1'
    if browser:
        PROFILE.mkdir(parents=True, exist_ok=True, mode=0o700)
        log = args.state_dir / 'browser.log'
        if log.exists() and log.stat().st_size > 1_000_000:
            log.replace(args.state_dir / 'browser.previous.log')
        with log.open('a') as output:
            subprocess.Popen([browser, '--user-data-dir=' + str(PROFILE), '--no-first-run', '--no-default-browser-check', '--app=' + url],
                             stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    print('Azeroth Live Map: ' + url)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        message = str(error)
        print('Azeroth Live Map: ' + message, file=sys.stderr)
        if '--notify' in sys.argv:
            try:
                subprocess.run(['notify-send', 'Azeroth Live Map', message], check=False, timeout=5)
            except (OSError, subprocess.SubprocessError):
                pass
        sys.exit(1)
