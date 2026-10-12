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

async function route(e, url) {
  let page = url.searchParams.get("gtp");
  if (page && e.resultingClientId) owners.set(e.resultingClientId, page);
  if (!page) page = owners.get(e.clientId);
  const top = await inviteClient(page);
  if (!top) return new Response("Open the invite link again to reconnect.", { status: 503, headers: { "content-type": "text/plain" } });
  const method = e.request.method;
  const body = method === "GET" || method === "HEAD" ? undefined : await e.request.text();
  const ch = new MessageChannel();
  const r = await new Promise((resolve) => {
    const t = setTimeout(() => resolve({ status: 504, type: "text/plain", body: new TextEncoder().encode("The table did not answer.").buffer }), 20000);
    ch.port1.onmessage = (m) => (clearTimeout(t), resolve(m.data));
    top.postMessage({ type: "gt-req", method, path: url.pathname + url.search, body }, [ch.port2]);
  });
  return new Response(r.status === 204 || r.status === 304 ? null : r.body, { status: r.status, headers: { "content-type": r.type, "cache-control": "no-store" } });
}
