const { readFile } = require('node:fs/promises');
const path = require('node:path');

const ORIGIN = 'azeroth://companion';
// Forever's native character meshes exceed the older Classic 16 MiB ceiling.
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_BYTES = 192 * 1024 * 1024;
const MAX_ITEM_BYTES = 512 * 1024;
const MODEL_PATH = /^(?:meta\/(?:character|charactercustomization|item|armor\/[0-9]{1,2})\/[0-9]{1,8}\.json|(?:m2|skin|skel|bone)\/[0-9]{1,8}\.(?:m2|skin|skel|bone)|textures\/[0-9]{1,8}\.(?:webp|png))$/;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://wow.zamimg.com; connect-src 'self' https://wow.zamimg.com https://nether.wowhead.com; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-src 'none'; form-action 'none'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8' };

function isAppURL(value) {
  try { const u = new URL(value); return u.protocol === 'azeroth:' && u.host === 'companion' && !u.username && !u.password; }
  catch { return false; }
}

function modelURL(value) {
  if (!isAppURL(value)) return null;
  const u = new URL(value);
  if (u.search || u.hash || !u.pathname.startsWith('/_model/')) return null;
  const name = u.pathname.slice('/_model/'.length);
  if (name === 'viewer.js') return 'https://wow.zamimg.com/modelviewer/live/viewer/viewer.min.js';
  if (name === 'viewer.css') return 'https://wow.zamimg.com/modelviewer/viewer/viewer.css';
  return MODEL_PATH.test(name) ? 'https://wow.zamimg.com/modelviewer/classicplus/' + name : null;
}

function itemURL(value) {
  if (!isAppURL(value)) return null;
  const u = new URL(value);
  const match = /^\/_items\/([1-9][0-9]{0,7})\.json$/.exec(u.pathname);
  return match && !u.search && !u.hash ? `https://www.wowhead.com/forever/item=${match[1]}&xml` : null;
}

function itemModel(xml, id) {
  // Read only the numeric fields from Wowhead's item XML; never send its
  // markup or scripts to the renderer. A mismatched item must not dress it.
  const item = /<item\s+id=["']([0-9]+)["']\s*>/.exec(xml);
  const display = /<icon\s+displayId=["']([0-9]{1,8})["']\s*>/.exec(xml);
  const inventory = /<inventorySlot\s+id=["']([0-9]{1,2})["']\s*>/.exec(xml);
  if (!item || Number(item[1]) !== id || !display || Number(display[1]) < 1 || !inventory || Number(inventory[1]) < 1 || Number(inventory[1]) > 28) return null;
  return { display: Number(display[1]), inventoryType: Number(inventory[1]) };
}

function localFile(value, root) {
  if (!isAppURL(value)) return null;
  let name;
  try { name = decodeURIComponent(new URL(value).pathname); } catch { return null; }
  if (name.includes('\\') || name.includes('\0') || name.split('/').includes('..')) return null;
  const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? file : null;
}

function externalURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'www.wowhead.com' && !u.port && !u.username && !u.password;
  } catch { return false; }
}

function createResourceHandler(root, fetchAsset = fetch) {
  const cache = new Map();
  let cacheSize = 0;
  function response(body, status = 200, type = 'text/plain; charset=utf-8') {
    return new Response(body, { status, headers: { 'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' } });
  }
  return async request => {
    if (request.method !== 'GET') return response('Method not allowed', 405);
    if (!isAppURL(request.url)) return response('Not found', 404);
    const pathname = new URL(request.url).pathname;
    const equipment = pathname.startsWith('/_items/');
    if (equipment || pathname.startsWith('/_model/')) {
      const url = equipment ? itemURL(request.url) : modelURL(request.url);
      if (!url) return response('Model asset not found', 404);
      if (cache.has(url)) {
        const asset = cache.get(url); cache.delete(url); cache.set(url, asset);
        return response(asset.data, 200, asset.type);
      }
      try {
        // Request only public allowlisted assets, without forwarding renderer headers.
        const remote = await fetchAsset(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!remote.ok) { await remote.body?.cancel(); return response('Model asset unavailable', remote.status === 404 ? 404 : 502); }
        const limit = equipment ? MAX_ITEM_BYTES : MAX_ASSET_BYTES;
        if (Number(remote.headers.get('content-length')) > limit) { await remote.body?.cancel(); return response('Model asset too large', 502); }
        const chunks = []; let bytes = 0;
        for await (const chunk of remote.body) {
          bytes += chunk.length;
          if (bytes > limit) throw new Error('Model asset too large');
          chunks.push(Buffer.from(chunk));
        }
        let data = Buffer.concat(chunks);
        if (equipment) {
          const model = itemModel(data.toString('utf8'), Number(pathname.match(/[0-9]+/)[0]));
          if (!model) return response('Forever item appearance unavailable', 404);
          data = Buffer.from(JSON.stringify(model)); bytes = data.length;
        }
        if (url.endsWith('/viewer.min.js')) {
          // The upstream viewer uses a protocol-relative stylesheet URL. Resolve it
          // through the same bounded asset route rather than the app's custom scheme.
          data = Buffer.from(data.toString('utf8').replaceAll('//wow.zamimg.com/modelviewer/viewer/viewer.css', '/_model/viewer.css'));
          bytes = data.length;
        }
        const type = equipment ? TYPES['.json'] : url.endsWith('.js') ? TYPES['.js'] : (TYPES[path.extname(url)] || 'application/octet-stream');
        while (cache.size && cacheSize + bytes > MAX_CACHE_BYTES) { const first = cache.keys().next().value; cacheSize -= cache.get(first).data.length; cache.delete(first); }
        // Another request may have completed while this one was downloading.
        if (cache.has(url)) cacheSize -= cache.get(url).data.length;
        cache.set(url, { data, type }); cacheSize += bytes;
        return response(data, 200, type);
      } catch { return response('Model asset unavailable', 502); }
    }
    const file = localFile(request.url, root);
    if (!file) return response('Not found', 404);
    try { return response(await readFile(file), 200, TYPES[path.extname(file)] || 'application/octet-stream'); }
    catch { return response('Not found', 404); }
  };
}

module.exports = { ORIGIN, CSP, MAX_ASSET_BYTES, MAX_ITEM_BYTES, isAppURL, modelURL, itemURL, itemModel, localFile, externalURL, createResourceHandler };
