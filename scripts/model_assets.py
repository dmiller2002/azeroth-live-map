"""Read-only, bounded access to public TBC model assets for the local app."""
from collections import OrderedDict
import re
import threading
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

MODEL_PREFIX = '/_model/'
MAX_ASSET_BYTES = 16 * 1024 * 1024
MAX_CACHE_BYTES = 48 * 1024 * 1024
_cache, _cache_size, _lock = OrderedDict(), 0, threading.Lock()
_paths = re.compile(r'(?:meta/(?:character|charactercustomization|item|armor/[0-9]{1,2})/[0-9]{1,8}\.json|(?:m2|skin|skel|bone)/[0-9]{1,8}\.(?:m2|skin|skel|bone)|textures/[0-9]{1,8}\.(?:webp|png))\Z')

def model_asset_url(path):
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or not parsed.path.startswith(MODEL_PREFIX):
        return None
    name = parsed.path[len(MODEL_PREFIX):]
    if name == 'viewer.js':
        return 'https://wow.zamimg.com/modelviewer/live/viewer/viewer.min.js'
    if not _paths.fullmatch(name):
        return None
    return 'https://wow.zamimg.com/modelviewer/tbc/' + name

def fetch_model_asset(path):
    global _cache_size
    url = model_asset_url(path)
    if not url:
        return 404, b'Model asset not found', 'text/plain; charset=utf-8'
    with _lock:
        cached = _cache.get(url)
        if cached:
            _cache.move_to_end(url)
            return 200, cached[0], cached[1]
    try:
        # Never forward browser cookies, origin, authorization, or other headers.
        with urlopen(Request(url), timeout=15) as response:
            if not response.url.startswith('https://wow.zamimg.com/modelviewer/'):
                return 502, b'Model asset unavailable', 'text/plain'
            if int(response.headers.get('Content-Length', '0')) > MAX_ASSET_BYTES:
                return 502, b'Model asset too large', 'text/plain'
            data = response.read(MAX_ASSET_BYTES + 1)
            if len(data) > MAX_ASSET_BYTES:
                return 502, b'Model asset too large', 'text/plain'
            mime = 'text/javascript; charset=utf-8' if path.endswith('viewer.js') else response.headers.get_content_type()
    except HTTPError as error:
        return (404 if error.code == 404 else 502), b'Model asset unavailable', 'text/plain'
    except (URLError, OSError, ValueError):
        return 502, b'Model asset unavailable', 'text/plain'
    with _lock:
        if url not in _cache:
            while _cache and _cache_size + len(data) > MAX_CACHE_BYTES:
                _, removed = _cache.popitem(last=False); _cache_size -= len(removed[0])
            _cache[url] = (data, mime); _cache_size += len(data)
    return 200, data, mime
