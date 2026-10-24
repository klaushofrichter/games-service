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

describe("hardening (review findings)", () => {
  const raw = (port: number, request: string) =>
    new Promise<string>((resolve) => {
      import("node:net").then(({ connect }) => {
        const s = connect(port, "127.0.0.1", () => s.write(request));
        let out = "";
        s.on("data", (d) => (out += d));
        s.on("close", () => resolve(out));
        s.on("error", () => resolve(out));
        setTimeout(() => s.destroy(), 1000);
      });
    });

  it("a request target that is not a URL gets 400 and the service keeps running", async () => {
    await start();
    expect(await raw(cloud!.port, "GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")).toMatch(/^HTTP\/1\.1 400/);
    expect(await raw(cloud!.port, "GET //[ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")).toMatch(/^HTTP\/1\.1 400/);
    expect((await get("/health")).status).toBe(200);
  });

  it("a badly encoded cookie from another service is ignored, not a 500", async () => {
    await start();
    const { session } = await signIn("admin@example.com");
    expect((await get("/", { cookie: "other=50%" })).status).toBe(200);
    expect((await get("/admin/api/me", { cookie: `other=50%; __Host-games_admin=${session}` })).status).toBe(200);
  });

  it("unauthenticated table hellos are rate limited per address", async () => {
    await start();
    const hello = (i: number) => fetch(`${base}/api/tables/hello`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tableId: `flood-table-${i}` }) });
    const codes: number[] = [];
    for (let i = 0; i < 65; i++) codes.push((await hello(i)).status);
    expect(codes.slice(0, 60).every((c) => c === 202)).toBe(true);
    expect(codes.slice(60)).toContain(429);
  });
});

describe("console top bar, favicon and version label", () => {
  const withVersion = async (v: string | undefined, fn: () => Promise<void>) => {
    const before = process.env.APP_VERSION;
    if (v === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = v;
    try {
      await fn();
    } finally {
      if (before === undefined) delete process.env.APP_VERSION;
      else process.env.APP_VERSION = before;
    }
  };

  it("serves the favicon, and every page links it", async () => {
    await start();
    const icon = await get("/favicon.svg");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    expect(await icon.text()).toMatch(/^<svg /);
    const { session } = await signIn("admin@example.com");
    for (const html of [await (await get("/")).text(), await (await get("/admin", { cookie: `__Host-games_admin=${session}` })).text()]) {
      expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
    }
  });

  it("the console's top bar shows the icon, 'Game Table Console' linked to the repository, and the version", async () => {
    await withVersion("2026.10.13.2", async () => {
      await start();
      const { session } = await signIn("admin@example.com");
      const html = await (await get("/admin", { cookie: `__Host-games_admin=${session}` })).text();
      const header = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
      expect(header).toContain('<a class="brand" href="https://github.com/klaushofrichter/games-service"');
      expect(header).toContain('<img src="/favicon.svg" alt=""><h1>Game Table Console</h1></a>');
      // bare version, exactly once, linked to its release (the tag carries the v)
      expect(header).toContain('<a class="version" href="https://github.com/klaushofrichter/games-service/releases/tag/v2026.10.13.2"');
      expect(header.match(/2026\.10\.13\.2</g)).toHaveLength(1);
      expect(header).not.toContain(">v2026");
      expect(html).not.toMatch(/\{\{(version|repo)\}\}/);
    });
  });

  it("labels main and dev builds without a release link, and shows the version on the public page", async () => {
    await withVersion("main", async () => {
      await start();
      expect(await (await get("/")).text()).toContain('href="https://github.com/klaushofrichter/games-service/commits/main"');
      await cloud!.close();
    });
    await withVersion(undefined, async () => {
      await start();
      expect(await (await get("/")).text()).toContain('<span class="version">dev</span>');
    });
  });

  it("answers HEAD like GET, as the uptime monitor only sends HEAD", async () => {
    await start();
    for (const path of ["/", "/health", "/favicon.svg"]) {
      const r = await fetch(base + path, { method: "HEAD" });
      expect(r.status, path).toBe(200);
      expect(await r.text(), path).toBe("");
    }
  });
});

describe("the console on a host of its own (CONSOLE_URL, D-204)", () => {
  const CONSOLE = "https://games-console.skylar.technology";
  const startSplit = () => start({ consoleUrl: CONSOLE, google: google({ redirectUri: `${CONSOLE}/auth/google/callback` }), adminToken: "script-token-0123456789" });
  /** A request as the ingress forwards it: to our port, with the browser's Host. */
  const at = (host: string, path: string, headers: Record<string, string> = {}, method = "GET", body?: string) =>
    new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; text: string }>((resolve, reject) => {
      import("node:http").then(({ request }) => {
        const r = request({ host: "127.0.0.1", port: cloud!.port, path, method, headers: { host, ...headers } }, (res) => {
          let text = "";
          res.on("data", (d) => (text += d));
          res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, text }));
        });
        r.on("error", reject);
        r.end(body);
      });
    });
  const consoleHost = new URL(CONSOLE).host;
  const publicHost = new URL(PUBLIC).host;
  /** Signs in on the console's host and returns the session cookie value. */
  async function signInThere(email: string) {
    const login = await at(consoleHost, "/auth/google/login");
    expect(new URL(String(login.headers.location)).searchParams.get("redirect_uri")).toBe(`${CONSOLE}/auth/google/callback`);
    const stateCookie = (login.headers["set-cookie"] ?? []).find((c) => c.startsWith("games_oauth_state="))!.split(";")[0];
    const state = decodeURIComponent(stateCookie.split("=")[1]);
    const cb = await at(consoleHost, `/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(email)}`, { cookie: stateCookie });
    expect(cb.headers.location).toBe("/admin");
    const c = (cb.headers["set-cookie"] ?? []).find((x) => x.startsWith("__Host-games_admin="))!;
    expect(c).toMatch(/Secure/);
    expect(c).not.toMatch(/Domain=/i); // host-only: never sent to the public host
    return c.split(";")[0].slice("__Host-games_admin=".length);
  }

  it("signs in and serves the console only on the console's host", async () => {
    await startSplit();
    const session = await signInThere("admin@example.com");
    const cookie = `__Host-games_admin=${session}`;
    expect((await at(consoleHost, "/admin", { cookie })).status).toBe(200);
    expect(JSON.parse((await at(consoleHost, "/admin/api/me", { cookie })).text)).toEqual({ via: "google", email: "admin@example.com" });
    // Signed in, the console's "/" opens the console; anonymous, it is a page with a Sign in link.
    expect((await at(consoleHost, "/", { cookie })).headers.location).toBe("/admin");
    const anon = await at(consoleHost, "/");
    expect(anon.status).toBe(200);
    expect(anon.text).toContain('href="/auth/google/login"');
    expect((await at(consoleHost, "/admin")).headers.location).toBe("/");
    // Nothing of the public website or remote play on the console's host.
    for (const path of ["/i/ABCDEFGH", "/dl/x", "/site/x.png", "/api/tables/hello"]) expect((await at(consoleHost, path)).status, path).toBe(404);
  });

  it("the public host never accepts the session, even a cookie left there from before, and sends people to the console", async () => {
    await startSplit();
    const session = await signInThere("admin@example.com");
    const cookie = `__Host-games_admin=${session}`;
    expect((await at(publicHost, "/admin/api/me", { cookie })).status).toBe(401);
    const put = await at(publicHost, "/admin/api/settings", { cookie, origin: PUBLIC, "content-type": "application/json" }, "PUT", JSON.stringify({ logRetentionDays: 30 }));
    expect(put.status).toBe(401);
    for (const path of ["/admin", "/auth/google/login", "/auth/logout"]) {
      const r = await at(publicHost, path, { cookie });
      expect(r.status, path).toBe(302);
      expect(r.headers.location, path).toBe(`${CONSOLE}${path}`);
      expect(String(r.headers["set-cookie"]), path).toMatch(/^__Host-games_admin=; Path=\/; Max-Age=0/);
    }
    // The website links the console's host and can't tell who is signed in there.
    const home = await at(publicHost, "/", { cookie });
    expect(home.status).toBe(200);
    expect(home.text).toContain(`<a id="admin-link" href="${CONSOLE}/">Admin</a>`);
    // Scripts with ADMIN_TOKEN work on either host.
    for (const host of [publicHost, consoleHost]) expect((await at(host, "/admin/api/tables", { authorization: "Bearer script-token-0123456789" })).status, host).toBe(200);
  });

  it("a cookie-authenticated change must come from the console's origin, not the public one", async () => {
    await startSplit();
    const cookie = `__Host-games_admin=${await signInThere("admin@example.com")}`;
    const put = (origin: string) => at(consoleHost, "/admin/api/settings", { cookie, origin, "content-type": "application/json" }, "PUT", JSON.stringify({ logRetentionDays: 30 }));
    expect((await put(PUBLIC)).status).toBe(401); // a page on the public host is the same site, so only the origin tells
    expect((await put(CONSOLE)).status).toBe(200);
  });

  it("logout on the console's host lands on its signed-out page", async () => {
    await startSplit();
    const cookie = `__Host-games_admin=${await signInThere("admin@example.com")}`;
    const out = await at(consoleHost, "/auth/logout", { cookie });
    expect(out.headers.location).toBe("/?signed-out=1");
    const page = await at(consoleHost, "/?signed-out=1");
    expect(page.text).toContain("You are signed out");
    expect(page.text).not.toContain("accounts.google.com");
  });
});
