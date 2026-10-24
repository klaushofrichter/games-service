// TURN relays from Cloudflare (D-209). A remote browser on a phone's hotspot or cellular data sits behind the carrier's
// NAT, and a direct WebRTC connection to the table often can't be made; a TURN server relays it. The service holds a
// Cloudflare TURN key (CF_TURN_KEY_ID, CF_TURN_API_TOKEN) and asks Cloudflare for short-lived credentials, which go to
// both ends with each connection; the key never leaves the service. WebRTC uses the relay only when a direct
// connection fails. Without the key, or when Cloudflare can't be reached, the plain STUN list is used, as before.
import type { IceServer } from "./server.ts";

export interface CloudflareTurn {
  keyId: string;
  apiToken: string;
  /** Tests only: Cloudflare's API base and fetch. */
  apiUrl?: string;
  fetch?: typeof fetch;
}

/** How long credentials live; renewed when less than RENEW_MS is left, so a connection made now holds for hours. */
const TTL_S = 86400;
const RENEW_MS = 12 * 3600_000;
/** After a failed request, the fallback for this long before asking Cloudflare again. */
const RETRY_MS = 60_000;

/** Port 53 URLs out: browsers refuse that port, and each one only adds a timeout (Cloudflare's own advice). */
function clean(list: unknown): IceServer[] {
  if (!Array.isArray(list)) return [];
  const out: IceServer[] = [];
  for (const s of list) {
    const urls = (Array.isArray(s?.urls) ? s.urls : [s?.urls]).filter((u: unknown): u is string => typeof u === "string" && !/:53(\?|$)/.test(u));
    if (!urls.length) continue;
    out.push({ urls, ...(typeof s.username === "string" ? { username: s.username } : {}), ...(typeof s.credential === "string" ? { credential: s.credential } : {}) });
  }
  return out;
}

/** The ICE servers for a new connection: Cloudflare's, kept and renewed, or the fallback. */
export function iceProvider(fallback: IceServer[], cf: CloudflareTurn | null, log: (msg: string) => void = (m) => console.warn(`[cloud] ${m}`)) {
  if (!cf) return async () => fallback;
  let cached: { servers: IceServer[]; until: number } | null = null;
  let pending: Promise<void> | null = null;
  let failedAt = 0;
  const url = `${cf.apiUrl ?? "https://rtc.live.cloudflare.com"}/v1/turn/keys/${encodeURIComponent(cf.keyId)}/credentials/generate-ice-servers`;
  const renew = async () => {
    try {
      const r = await (cf.fetch ?? fetch)(url, {
        method: "POST",
        headers: { authorization: `Bearer ${cf.apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: TTL_S }),
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const servers = clean(((await r.json()) as { iceServers?: unknown }).iceServers);
      if (!servers.some((s) => s.credential)) throw new Error("no TURN server in the answer");
      cached = { servers, until: Date.now() + TTL_S * 1000 };
    } catch (e) {
      failedAt = Date.now();
      log(`Cloudflare TURN credentials: ${(e as Error).message}; ${cached && cached.until > Date.now() ? "keeping the current ones" : "using STUN only"}`);
    }
  };
  return async (): Promise<IceServer[]> => {
    const now = Date.now();
    if (cached && cached.until - now > RENEW_MS) return cached.servers;
    if (now - failedAt >= RETRY_MS) await (pending ??= renew().finally(() => (pending = null)));
    return cached && cached.until > Date.now() ? cached.servers : fallback;
  };
}
