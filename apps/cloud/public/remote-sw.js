// Service worker for remote players (phase 1c, D-020). The invite page (/i/CODE) holds a WebRTC data
// channel to the table; this worker routes the board's and deck's requests (/board, /deck, /shared,
// /games, /api/v1) to that page, which sends them over the channel. Nothing else is touched.
const ROUTED = /^\/(board|deck|shared|games|api\/v1)(\/|$)/;
const pages = new Map(); // page id -> client id of its invite page
const owners = new Map(); // client id of a board/deck frame -> page id

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => {
  if (!e.source || !e.data) return;
  if (e.data.type === "gt-register") pages.set(String(e.data.page), e.source.id);
  if (e.data.type === "gt-own" && e.data.page) owners.set(e.source.id, String(e.data.page));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !ROUTED.test(url.pathname)) return;
  e.respondWith(route(e, url));
});

async function inviteClient(page) {
  const id = page && pages.get(page);
  const c = id && (await self.clients.get(id));
  if (c) return c;
  // The worker may have been restarted and lost its maps. Guess only when there is exactly one invite
  // page; with several (invites to different tables) a wrong guess would send requests to the wrong table.
  const all = (await self.clients.matchAll({ type: "window" })).filter((x) => new URL(x.url).pathname.startsWith("/i/"));
  return all.length === 1 ? all[0] : null;
}

// A game's assets (images, sounds) are kept for a while (D-152): a game that redraws its deck refetched every picture
// over the data channel on every update, and the deck flickered blank. Only successful GETs under /games/<id>/assets/,
// in memory (gone when the worker restarts), at most ASSET_BYTES in all; a game updated in between shows its new
// assets after ASSET_TTL_MS.
const ASSET = /^\/games\/[^/]+\/assets\//;
const ASSET_TTL_MS = 10 * 60 * 1000;
const ASSET_BYTES = 64 * 1024 * 1024;
const assets = new Map(); // path -> { at, type, body }
let assetBytes = 0;
function keepAsset(path, r) {
  const size = r.body?.byteLength ?? 0;
  if (r.status !== 200 || size > ASSET_BYTES / 8) return;
  const old = assets.get(path);
  if (old) assetBytes -= old.body.byteLength;
  assets.set(path, { at: Date.now(), type: r.type, body: r.body });
  assetBytes += size;
  for (const [k, v] of assets) {
    if (assetBytes <= ASSET_BYTES) break;
    assets.delete(k);
    assetBytes -= v.body.byteLength;
  }
}

async function route(e, url) {
  let page = url.searchParams.get("gtp");
  if (page && e.resultingClientId) {
    // Each (re)load of a frame is a new client: forget the ones that are gone, or the map only grows.
    for (const id of owners.keys()) if (!(await self.clients.get(id))) owners.delete(id);
    owners.set(e.resultingClientId, page);
  }
  if (!page) page = owners.get(e.clientId);
  const top = await inviteClient(page);
  if (!top) return new Response("Open the invite link again to reconnect.", { status: 503, headers: { "content-type": "text/plain" } });
  const method = e.request.method;
  const path = url.pathname + url.search;
  const asset = method === "GET" && ASSET.test(url.pathname);
  const kept = asset && assets.get(path);
  if (kept && Date.now() - kept.at < ASSET_TTL_MS) return new Response(kept.body.slice(0), { status: 200, headers: { "content-type": kept.type, "cache-control": "private, max-age=600" } });
  const body = method === "GET" || method === "HEAD" ? undefined : await e.request.text();
  const ch = new MessageChannel();
  const r = await new Promise((resolve) => {
    const t = setTimeout(() => resolve({ status: 504, type: "text/plain", body: new TextEncoder().encode("The table did not answer.").buffer }), 20000);
    ch.port1.onmessage = (m) => (clearTimeout(t), resolve(m.data));
    top.postMessage({ type: "gt-req", method, path, body }, [ch.port2]);
  });
  if (asset) {
    keepAsset(path, r);
    if (r.status === 200) return new Response(r.body, { status: 200, headers: { "content-type": r.type, "cache-control": "private, max-age=600" } });
  }
  return new Response(r.status === 204 || r.status === 304 ? null : r.body, { status: r.status, headers: { "content-type": r.type, "cache-control": "no-store" } });
}
