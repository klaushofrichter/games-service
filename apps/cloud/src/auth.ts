// Admin sign-in with Google, following the cluster's pattern (kube-setup vault, "Building a New Service" → Google OAuth):
// openid+email scope, a random `state` echoed in a cookie (CSRF), verifyIdToken against our client ID, an allow-list of
// emails (ALLOWED_EMAILS), and an HMAC-signed session cookie (COOKIE_SECRET). Logout clears the cookie and lands on a
// public page with a Sign in link — never a bounce through Google, which would sign the user silently back in.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { OAuth2Client } from "google-auth-library";

export interface GoogleAuthOptions {
  clientId: string;
  clientSecret: string;
  /** Must equal the console's "Authorised redirect URI" character for character: https://<host>/auth/google/callback */
  redirectUri: string;
  /** Lower-cased; checked at sign-in AND on every request, so removing an address takes effect at once. */
  allowedEmails: string[];
  /** Signs the session cookie. Replacing it (and restarting) ends every session: the kill switch. */
  cookieSecret: string;
  /** Session lifetime in seconds (default 7 days). */
  sessionSeconds?: number;
  /** Tests only: replaces the code exchange with Google. */
  exchangeCode?: (code: string) => Promise<{ email: string; emailVerified: boolean }>;
}

export interface AdminAuth {
  /** Handles /auth/*; returns true when it answered the request. */
  handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean>;
  /** The signed-in admin's email, or null. */
  session(req: IncomingMessage): string | null;
  readonly enabled: boolean;
}

const STATE_COOKIE = "games_oauth_state";

export function cookies(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    // Cookies for the whole skylar.technology domain reach us too; one badly encoded value must not break the page.
    try {
      out.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
    } catch {
      /* skip it */
    }
  }
  return out;
}

/** Session cookie value: base64url(JSON {e: email, x: expiry ms}) "." HMAC-SHA256 of that, base64url. */
export function signSession(secret: string, email: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ e: email, x: expiresAt })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function verifySession(secret: string, value: string | undefined): string | null {
  if (!value) return null;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return null;
  const want = createHmac("sha256", secret).update(payload).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof e === "string" && typeof x === "number" && x > Date.now() ? e : null;
  } catch {
    return null;
  }
}

/**
 * @param publicUrl the service's own URL; https decides the Secure attribute and the __Host- cookie prefix
 *   (plain http is only for local development and tests).
 */
export function createAdminAuth(o: GoogleAuthOptions | null, publicUrl: string): AdminAuth {
  const secure = publicUrl.startsWith("https://");
  // __Host- keeps the cookie on this exact host: a sibling *.skylar.technology service can neither read nor overwrite it.
  const SESSION_COOKIE = secure ? "__Host-games_admin" : "games_admin";
  const base = ["HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : [])];
  const set = (name: string, value: string, path: string, maxAge: number) =>
    `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; ${base.join("; ")}`;
  // Cleared with the same attributes it was set with: a cookie cleared with different ones is not removed.
  const clear = (name: string, path: string) => `${name}=; Path=${path}; Max-Age=0; ${base.join("; ")}`;
  const allowed = (email: string) => !!o && o.allowedEmails.includes(email.toLowerCase());

  const google = o && !o.exchangeCode ? new OAuth2Client({ clientId: o.clientId, clientSecret: o.clientSecret, redirectUri: o.redirectUri }) : null;
  const exchange =
    o?.exchangeCode ??
    (async (code: string) => {
      const { tokens } = await google!.getToken(code);
      const ticket = await google!.verifyIdToken({ idToken: tokens.id_token ?? "", audience: o!.clientId });
      const p = ticket.getPayload();
      return { email: String(p?.email ?? ""), emailVerified: p?.email_verified === true };
    });

  const page = (res: ServerResponse, status: number, title: string, body: string, headers: Record<string, string | string[]> = {}) => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer", ...headers });
    res.end(publicPage(title, body));
  };

  return {
    enabled: !!o,
    session(req) {
      if (!o) return null;
      const email = verifySession(o.cookieSecret, cookies(req).get(SESSION_COOKIE));
      return email && allowed(email) ? email : null;
    },
    async handle(req, res, path) {
      if (!path.startsWith("/auth/")) return false;
      if (path === "/auth/logout") {
        // GET, like the other services: logging someone out is not a harm worth a CSRF token.
        res.writeHead(302, { location: "/?signed-out=1", "cache-control": "no-store", "set-cookie": [clear(SESSION_COOKIE, "/"), clear(STATE_COOKIE, "/auth/google")] });
        res.end();
        return true;
      }
      if (!o) {
        page(res, 503, "Sign-in is not configured", `<p>Google sign-in is not configured on this service.</p><p><a href="/">Back</a></p>`);
        return true;
      }
      if (path === "/auth/google/login") {
        const state = randomBytes(24).toString("base64url");
        const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        auth.search = new URLSearchParams({ client_id: o.clientId, redirect_uri: o.redirectUri, response_type: "code", scope: "openid email", state, prompt: "select_account" }).toString();
        res.writeHead(302, { location: auth.toString(), "cache-control": "no-store", "set-cookie": set(STATE_COOKIE, state, "/auth/google", 600) });
        res.end();
        return true;
      }
      if (path === "/auth/google/callback") {
        const url = new URL(req.url ?? "/", "http://x");
        const state = url.searchParams.get("state") ?? "";
        const expected = cookies(req).get(STATE_COOKIE) ?? "";
        const clearState = clear(STATE_COOKIE, "/auth/google");
        const again = `<p><a class="btn" href="/auth/google/login">Sign in with Google</a></p>`;
        if (!state || !expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
          page(res, 400, "Sign-in expired", `<p>That sign-in attempt expired or did not start here. Please try again.</p>${again}`, { "set-cookie": clearState });
          return true;
        }
        const code = url.searchParams.get("code");
        if (!code) {
          page(res, 400, "Sign-in cancelled", `<p>Google did not complete the sign-in.</p>${again}`, { "set-cookie": clearState });
          return true;
        }
        let who: { email: string; emailVerified: boolean };
        try {
          who = await exchange(code);
        } catch {
          page(res, 502, "Sign-in failed", `<p>Google could not confirm the sign-in. Please try again.</p>${again}`, { "set-cookie": clearState });
          return true;
        }
        if (!who.emailVerified || !allowed(who.email)) {
          // Anyone with a Google account can reach this point: the allow-list is the actual gate.
          page(res, 403, "Not an administrator", `<p>${esc(who.email || "This account")} is not allowed to administer this service.</p><p><a class="btn" href="/auth/google/login">Use another account</a></p>`, { "set-cookie": clearState });
          return true;
        }
        const seconds = o.sessionSeconds ?? 7 * 86400;
        res.writeHead(302, { location: "/admin", "cache-control": "no-store", "set-cookie": [clearState, set(SESSION_COOKIE, signSession(o.cookieSecret, who.email.toLowerCase(), Date.now() + seconds * 1000), "/", seconds)] });
        res.end();
        return true;
      }
      return false;
    },
  };
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The small public page style shared by the landing page and the sign-in messages. */
export function publicPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Game Table</title>
<style>body{font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#0a1d19;color:#f3eee2;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:440px;padding:28px;text-align:center}h1{font-family:"Iowan Old Style",Palatino,Georgia,serif;font-weight:600}a{color:#d6a94a}
.btn{display:inline-block;margin-top:8px;padding:9px 20px;border-radius:999px;background:#d6a94a;color:#1b1407;font-weight:600;text-decoration:none}.muted{color:#b9b3a3}</style>
<main><h1>${esc(title)}</h1>${body}</main></html>`;
}
