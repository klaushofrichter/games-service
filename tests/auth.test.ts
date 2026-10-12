// Admin sign-in with Google (D-067): state check, allow-list, signed session, logout that really logs out,
// same-origin check on changes, the optional bearer token, and the trusted-proxy CIDR list.
import { afterEach, describe, expect, it } from "vitest";
import { startCloud } from "../apps/cloud/src/server.ts";
import { signSession, verifySession, type GoogleAuthOptions } from "../apps/cloud/src/auth.ts";

const SECRET = "c".repeat(64);
const PUBLIC = "https://games.skylar.technology";
let cloud: Awaited<ReturnType<typeof startCloud>> | null = null;
let base = "";
afterEach(async () => {
  await cloud?.close();
  cloud = null;
});

const google = (over: Partial<GoogleAuthOptions> = {}): GoogleAuthOptions => ({
  clientId: "40017202035-test.apps.googleusercontent.com",
  clientSecret: "secret",
  redirectUri: `${PUBLIC}/auth/google/callback`,
  allowedEmails: ["admin@example.com"],
  cookieSecret: SECRET,
  // The fake Google: the "code" is the email; "unverified:" marks an address Google has not verified.
  exchangeCode: async (code) => (code === "boom" ? Promise.reject(new Error("google down")) : { email: code.replace(/^unverified:/, ""), emailVerified: !code.startsWith("unverified:") }),
  ...over,
});
async function start(o: Partial<Parameters<typeof startCloud>[0]> = {}) {
  cloud = await startCloud({ port: 0, host: "127.0.0.1", publicUrl: PUBLIC, google: google(), ...o });
  base = `http://127.0.0.1:${cloud.port}`;
}
const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { redirect: "manual", headers });
const setCookies = (r: Response) => r.headers.getSetCookie();
const cookieValue = (r: Response, name: string) => setCookies(r).find((c) => c.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1);

/** Runs login → callback and returns the session cookie header to send. */
async function signIn(email: string) {
  const login = await get("/auth/google/login");
  const state = decodeURIComponent(cookieValue(login, "games_oauth_state")!);
  const cb = await get(`/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(email)}`, { cookie: `games_oauth_state=${state}` });
  return { cb, session: cookieValue(cb, "__Host-games_admin") };
}

describe("admin sign-in", () => {
  it("login redirects to Google with openid email scope, our redirect URI and a state that is also a cookie", async () => {
    await start();
    const r = await get("/auth/google/login");
    expect(r.status).toBe(302);
    const to = new URL(r.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("scope")).toBe("openid email");
    expect(to.searchParams.get("redirect_uri")).toBe(`${PUBLIC}/auth/google/callback`);
    const state = to.searchParams.get("state")!;
    expect(state.length).toBeGreaterThan(20);
    const c = setCookies(r).find((x) => x.startsWith("games_oauth_state="))!;
    expect(decodeURIComponent(c.split(";")[0].split("=")[1])).toBe(state);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/SameSite=Lax/);
  });

  it("an allowed, verified account gets a signed session cookie and lands on /admin", async () => {
    await start();
    const { cb, session } = await signIn("Admin@Example.com");
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/admin");
    const c = setCookies(cb).find((x) => x.startsWith("__Host-games_admin="))!;
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/SameSite=Lax/);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Max-Age=604800/);
    const page = await get("/admin", { cookie: `__Host-games_admin=${session}` });
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    const me = await (await get("/admin/api/me", { cookie: `__Host-games_admin=${session}` })).json();
    expect(me).toEqual({ via: "google", email: "admin@example.com" });
  });

  it("rejects a missing or wrong state (CSRF) and never sets a session", async () => {
    await start();
    for (const [q, cookie] of [
      ["state=abc&code=admin@example.com", ""],
      ["state=abc&code=admin@example.com", "games_oauth_state=xyz"],
      ["code=admin@example.com", "games_oauth_state=abc"],
    ]) {
      const r = await get(`/auth/google/callback?${q}`, cookie ? { cookie } : {});
      expect(r.status).toBe(400);
      expect(cookieValue(r, "__Host-games_admin")).toBeUndefined();
    }
  });

  it("refuses accounts not on the allow-list, unverified emails and a failed exchange", async () => {
    await start();
    expect((await signIn("someone@example.com")).cb.status).toBe(403);
    expect((await signIn("unverified:admin@example.com")).cb.status).toBe(403);
    expect((await signIn("boom")).cb.status).toBe(502);
    for (const e of ["someone@example.com", "unverified:admin@example.com", "boom"]) expect((await signIn(e)).session).toBeUndefined();
  });

  it("anonymous visitors to /admin go to the public page, which answers 200 with a Sign in link (not Google)", async () => {
    await start();
    const r = await get("/admin");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/");
    const home = await get("/");
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('href="/auth/google/login"');
    expect((await get("/admin/api/tables")).status).toBe(401);
  });

  it("logout clears the cookie with the attributes it was set with and lands on a 200 signed-out page", async () => {
    await start();
    const { session } = await signIn("admin@example.com");
    const out = await get("/auth/logout", { cookie: `__Host-games_admin=${session}` });
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe("/?signed-out=1");
    const cleared = setCookies(out).find((x) => x.startsWith("__Host-games_admin="))!;
    expect(cleared).toMatch(/^__Host-games_admin=;/);
    expect(cleared).toMatch(/Max-Age=0/);
    expect(cleared).toMatch(/Path=\//);
    expect(cleared).toMatch(/HttpOnly/);
    expect(cleared).toMatch(/Secure/);
    expect(cleared).toMatch(/SameSite=Lax/);
    expect(out.headers.get("clear-site-data")).toBeNull(); // would sign out every *.skylar.technology service
    const landing = await get("/?signed-out=1");
    expect(landing.status).toBe(200);
    const html = await landing.text();
    expect(html).toContain("You are signed out");
    expect(html).toContain('href="/auth/google/login"');
    expect(html).not.toContain("accounts.google.com");
  });

  it("removing an address from the allow-list ends that session at once; a new COOKIE_SECRET ends all of them", async () => {
    await start();
    const { session } = await signIn("admin@example.com");
    await cloud!.close();
    await start({ google: google({ allowedEmails: ["other@example.com"] }) });
    expect((await get("/admin/api/me", { cookie: `__Host-games_admin=${session}` })).status).toBe(401);
    await cloud!.close();
    await start({ google: google({ cookieSecret: "d".repeat(64) }) });
    expect((await get("/admin/api/me", { cookie: `__Host-games_admin=${session}` })).status).toBe(401);
  });

  it("a cookie-authenticated change must come from our own origin", async () => {
    await start();
    const { session } = await signIn("admin@example.com");
    const put = (origin?: string) =>
      fetch(`${base}/admin/api/settings`, { method: "PUT", headers: { cookie: `__Host-games_admin=${session}`, "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ logRetentionDays: 30 }) });
    expect((await put("https://evil.example")).status).toBe(401);
    expect((await put()).status).toBe(401);
    expect((await put(PUBLIC)).status).toBe(200);
  });

  it("ADMIN_TOKEN still works as a bearer token for scripts, and only when configured", async () => {
    await start({ adminToken: "script-token-0123456789" });
    expect((await get("/admin/api/tables", { authorization: "Bearer script-token-0123456789" })).status).toBe(200);
    expect(await (await get("/admin/api/me", { authorization: "Bearer script-token-0123456789" })).json()).toEqual({ via: "token" });
    await cloud!.close();
    await start();
    expect((await get("/admin/api/tables", { authorization: "Bearer " })).status).toBe(401);
  });

  it("session values are tamper-proof and expire", () => {
    const v = signSession(SECRET, "admin@example.com", Date.now() + 60_000);
    expect(verifySession(SECRET, v)).toBe("admin@example.com");
    expect(verifySession("x".repeat(64), v)).toBeNull();
    const [payload, mac] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ e: "evil@example.com", x: Date.now() + 60_000 })).toString("base64url");
    expect(verifySession(SECRET, `${forged}.${mac}`)).toBeNull();
    expect(verifySession(SECRET, `${payload}.`)).toBeNull();
    expect(verifySession(SECRET, signSession(SECRET, "admin@example.com", Date.now() - 1))).toBeNull();
  });

  it("/health reports status and the stamped version", async () => {
    process.env.APP_VERSION = "2026.10.12.1";
    try {
      await start();
      expect(await (await get("/health")).json()).toMatchObject({ status: "ok", version: "2026.10.12.1" });
    } finally {
      delete process.env.APP_VERSION;
    }
  });

  it("trusts X-Forwarded-For only from the listed proxy networks", async () => {
    // Invite lookups are rate limited per client address (20 a minute).
    const burst = async (xff: (i: number) => string) => {
      let limited = 0;
      for (let i = 0; i < 25; i++) if ((await get("/i/ZZZZZZZZ", { "x-forwarded-for": xff(i) })).status === 429) limited++;
      return limited;
    };
    await start({ trustProxy: ["127.0.0.0/8"] });
    expect(await burst((i) => `203.0.113.${i}`)).toBe(0); // distinct clients behind a trusted proxy
    await cloud!.close();
    await start({ trustProxy: ["10.42.0.0/16"] }); // the test client (127.0.0.1) is not a trusted proxy
    expect(await burst((i) => `203.0.113.${i}`)).toBeGreaterThan(0); // spoofed headers are ignored
  });
});
