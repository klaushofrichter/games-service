// The public website at "/" (D-176): the page with its sections, the admin link in the corner, the version label, its
// images under /site/, and nothing else reachable through that path.
import { readdir, readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { startCloud } from "../apps/cloud/src/server.ts";

let cloud: Awaited<ReturnType<typeof startCloud>> | null = null;
let base = "";
afterEach(async () => {
  await cloud?.close();
  cloud = null;
});
async function start(extra: { previewBanner?: boolean } = {}) {
  cloud = await startCloud({ port: 0, host: "127.0.0.1", publicUrl: "http://127.0.0.1", adminToken: "t".repeat(20), ...extra } as never);
  base = `http://127.0.0.1:${cloud.port}`;
}
const get = (path: string) => fetch(base + path, { redirect: "manual" });

describe("the public website (D-176)", () => {
  it("serves the page with its sections, the admin link, the version and no unfilled placeholders", async () => {
    await start();
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await r.text();
    for (const id of ["room", "games", "awards", "lobby", "build", "debug", "repos", "install", "table"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('<a id="admin-link" href="/admin">Admin</a>'); // without Google sign-in: the portal itself
    expect(html).toContain('class="version"');
    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(html).not.toContain("You are signed out");
    expect(await (await get("/?signed-out=1")).text()).toContain("You are signed out");
    // Only first-party resources: no fonts, scripts or images from elsewhere.
    expect(html).not.toMatch(/(src|href)="https?:\/\/(?!github\.com\/klaushofrichter\/)/);
    // The private game repositories are never named on the public page.
    expect(html).not.toMatch(/loopy|starforge/i);
  });

  it("shows the PREVIEW / DRAFT sash on the public page only, unless it is turned off (D-177)", async () => {
    await start();
    const sash = '<div class="preview-sash" role="note"';
    expect(await (await get("/")).text()).toContain(sash);
    expect(await (await get("/?signed-out=1")).text()).toContain(sash);
    // The admin portal and the remote player's invite page stay without it.
    for (const page of ["admin.html", "remote.html"]) {
      expect(await readFile(new URL(`../apps/cloud/public/${page}`, import.meta.url), "utf8"), page).not.toContain("preview-sash");
    }
    await cloud!.close();
    await start({ previewBanner: false });
    const off = await (await get("/")).text();
    expect(off).not.toContain(sash);
    expect(off).not.toMatch(/\{\{\w+\}\}/);
  });

  it("every image the page uses is served from /site/ with its type; other paths are not", async () => {
    await start();
    const html = await readFile(new URL("../apps/cloud/public/home.html", import.meta.url), "utf8");
    const used = new Set([...html.matchAll(/\/site\/([a-z0-9-]+\.(?:webp|svg))/g)].map((m) => m[1]));
    for (const g of ["holdem", "roulette", "pachisi", "coin-flip", "chess", "liars-dice", "backgammon"]) used.add(`${g}.webp`);
    const files = new Set(await readdir(new URL("../apps/cloud/public/site/", import.meta.url)));
    for (const f of used) {
      expect(files.has(f), f).toBe(true);
      const r = await get(`/site/${f}`);
      expect(r.status, f).toBe(200);
      expect(r.headers.get("content-type")).toBe(f.endsWith(".svg") ? "image/svg+xml" : "image/webp");
    }
    for (const bad of ["/site/missing.webp", "/site/../home.html", "/site/%2e%2e%2fhome.html", "/site/home.html", "/site/"]) {
      expect((await get(bad)).status, bad).not.toBe(200);
    }
  });
});
