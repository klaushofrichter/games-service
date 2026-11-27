// The public website at "/" (D-176): the page with its sections, the admin link in the corner, the version label, its
// images under /site/, and nothing else reachable through that path. Its pages are files of their own in one shell
// (D-323): each carries only what it needs, and all have the one look.
import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { assembleSitePage, SITE_PAGES, startCloud } from "../apps/cloud/src/server.ts";

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
  it("hides the close-up's phone image for a game without one (img[hidden] must stay display: none)", async () => {
    await start();
    const html = await (await get("/")).text();
    expect(html).toMatch(/img\[hidden\]\s*\{\s*display:\s*none;?\s*\}/); // a global img { display: block } would keep the last game's phone
  });

  it("serves the page with its sections, the admin link, the version and no unfilled placeholders", async () => {
    await start();
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await r.text();
    for (const id of ["room", "games", "awards", "lobby", "build", "repos", "install", "table", "service", "about"]) expect(html).toContain(`id="${id}"`);
    // The developers' part is a page of its own (D-312), in a file of its own (D-323); neither page carries the other's.
    const build = await (await get("/build")).text();
    for (const id of ["build", "case", "showcase", "sling", "synth", "ge150", "cards", "debug"]) expect(build).toContain(`id="${id}"`);
    for (const id of ["showcase", "debug", "cards"]) expect(html).not.toContain(`id="${id}"`);
    for (const id of ["hero", "games-grid", "demo", "repos"]) expect(build).not.toContain(`id="${id}"`);
    expect(build).toContain("<title>Build a game · Game Table</title>");
    expect(html).toContain("<title>Game Table: board games around one screen</title>");
    // The questions and answers (D-320): a third page, with its groups.
    const faq = await (await get("/faq")).text();
    for (const id of ["faq", "faq-start", "faq-dev", "faq-howto", "faq-play"]) expect(faq).toContain(`id="${id}"`);
    for (const id of ["hero", "games-grid", "showcase", "debug"]) expect(faq).not.toContain(`id="${id}"`);
    for (const page of [html, build]) expect(page).not.toContain('id="faq"');
    expect(faq).toContain("<title>Questions and answers · Game Table</title>");
    expect(faq.match(/<title>/g)).toHaveLength(1);
    for (const page of [html, build, faq]) {
      expect(page).toContain('href="/faq"');
      expect(page).not.toContain("{{"); // every place of the shell is filled: by the page's file, then by the request
      expect(page).not.toContain("}}");
      expect(page).toContain('class="version"');
    }
    // Every link to a place within the website has its place (D-312: the foot is on both pages, its links must work
    // from both): "#x" on the page itself, "/#x" on the landing page, "/build#x" on the developers' page.
    const ids = (page: string) => new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const places: Record<string, Set<string | undefined>> = { "/": ids(html), "/build": ids(build), "/faq": ids(faq) };
    for (const [path, page] of [["/", html], ["/build", build], ["/faq", faq]] as const) {
      for (const [, href] of page.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) {
        if (/^(https?:|mailto:)/.test(href!) || href!.includes("${")) continue; // (not the links the script writes: the browser check has those)
        const [to, anchor] = href!.split("#");
        const target = to === "" ? path : to!;
        if (anchor && places[target]) expect(places[target]!.has(anchor), `${path}: ${href}`).toBe(true);
      }
    }
    // Compressed for a browser that takes it.
    const zipped = await fetch(`${base}/build`, { headers: { "accept-encoding": "gzip" } });
    expect(zipped.headers.get("content-encoding")).toBe("gzip");
    expect(await zipped.text()).toBe(build);
    expect(html).toContain('<a id="admin-link" href="/admin">Admin</a>'); // without Google sign-in: the portal itself
    expect(html).toContain('class="version"');
    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(html).not.toContain("You are signed out");
    expect(await (await get("/?signed-out=1")).text()).toContain("You are signed out");
    // Only first-party resources: no fonts, scripts or images from elsewhere. Links go to the GitHub repositories and
    // to skylar.technology, the company that hosts the project (D-187).
    // One more, the emulator FM-1 Synth is built on, credited to its author (D-284).
    expect(html).not.toMatch(/(src|href)="https?:\/\/(?!github\.com\/klaushofrichter\/|skylar\.technology"|github\.com\/joakimeriksson\/fm1-emu")/);
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
    const html = (await Promise.all(["shell", ...Object.values(SITE_PAGES)].map((f) => readFile(new URL(`../apps/cloud/public/site-pages/${f}.html`, import.meta.url), "utf8")))).join("\n");
    const used = new Set([...html.matchAll(/\/site\/([a-z0-9-]+\.(?:webp|svg))/g)].map((m) => m[1]));
    for (const g of ["holdem", "roulette", "pachisi", "coin-flip", "freecell", "chess", "liars-dice", "backgammon", "mexican-train"]) used.add(`${g}.webp`);
    const files = new Set(await readdir(new URL("../apps/cloud/public/site/", import.meta.url)));
    for (const f of used) {
      expect(files.has(f), f).toBe(true);
      const r = await get(`/site/${f}`);
      expect(r.status, f).toBe(200);
      expect(r.headers.get("content-type")).toBe(f.endsWith(".svg") ? "image/svg+xml" : "image/webp");
    }
    // (the pages' source files are not served either: only the pages put together from them)
    for (const bad of ["/site/missing.webp", "/site/../home.html", "/site/%2e%2e%2fhome.html", "/site/home.html", "/site/", "/home.html", "/site-pages/shell.html", "/site-pages/home.html", "/site/../site-pages/shell.html"]) {
      expect((await get(bad)).status, bad).not.toBe(200);
    }
  });

  it("puts every page into the one shell: the same styles, top bar, foot and script, and only its own parts besides (D-323)", async () => {
    await start();
    const pages: Record<string, string> = {};
    for (const path of Object.keys(SITE_PAGES)) pages[path] = await (await get(path)).text();
    expect(Object.keys(pages)).toEqual(["/", "/build", "/faq", "/build-the-table"]);
    const cut = (page: string, from: string, to: string, nth = 0) => {
      let at = -1;
      for (let i = 0; i <= nth; i++) at = page.indexOf(from, at + 1);
      expect(at, from).toBeGreaterThan(-1);
      return page.slice(at, page.indexOf(to, at) + to.length);
    };
    // The shared look: the first style sheet of every page is the same text, and so are the foot and the shared script.
    const look = cut(pages["/"]!, "<style>", "</style>");
    for (const rule of [":root {", "body {", "h1, h2, h3 {", ".wrap {", ".btn {", ".section-head {", "header.top {", "nav.main {", ".preview-sash {", "footer {", ".js .rv {", "@media (max-width: 640px)", "prefers-reduced-motion"]) expect(look, rule).toContain(rule);
    const foot = cut(pages["/"]!, "<footer>", "</footer>");
    expect(foot).toContain('class="version"');
    const script = cut(pages["/"]!, "<script>", "</script>");
    expect(script).toContain("const site =");
    for (const [path, page] of Object.entries(pages)) {
      expect(cut(page, "<style>", "</style>"), `${path}: the shared styles`).toBe(look);
      expect(cut(page, "<footer>", "</footer>"), `${path}: the foot`).toBe(foot);
      expect(cut(page, "<script>", "</script>"), `${path}: the shared script`).toBe(script);
      expect(page.match(/<header class="top" id="top">/g), path).toHaveLength(1);
      expect(page.lastIndexOf("</style>"), `${path}: styles in the head`).toBeLessThan(page.indexOf("</head>"));
      expect(page.match(/<meta name="description" content="[^"]{40,}">/g), path).toHaveLength(1);
    }
    // The top bar comes from one list: the same links in the same order everywhere, places as "#x" on the landing
    // page and "/#x" elsewhere, the logo to the top of the landing page, and the page itself marked.
    const nav = (page: string) => [...cut(page, '<nav class="main"', "</nav>").matchAll(/<a( class="on")? href="([^"]+)"( aria-current="page")?>([^<]+)<\/a>/g)].map((m) => ({ on: !!m[1] && !!m[3], href: m[2]!, label: m[4]! }));
    const home = nav(pages["/"]!);
    expect(home.map((a) => a.href)).toEqual(["#room", "#games", "#lobby", "/build", "#download", "#install", "#table", "/faq"]);
    expect(home.some((a) => a.on)).toBe(false);
    expect(pages["/"]).toContain('<a class="logo" href="#"><img src="/favicon.svg" alt="">Game Table</a>');
    for (const path of ["/build", "/faq"]) {
      const links = nav(pages[path]!);
      expect(links.map((a) => a.label), path).toEqual(home.map((a) => a.label));
      expect(links.map((a) => a.href), path).toEqual(home.map((a) => (a.href.startsWith("#") ? `/${a.href}` : a.href)));
      expect(links.filter((a) => a.on).map((a) => a.href), path).toEqual([path]);
      expect(pages[path], path).toContain('<a class="logo" href="/"><img src="/favicon.svg" alt="">Game Table</a>');
    }
    // Build the table (D-329): served with the shared top bar, but not linked from it, the foot or another page yet,
    // and search engines are asked to leave it out until it is.
    const table = pages["/build-the-table"]!;
    expect(nav(table).map((a) => a.label)).toEqual(home.map((a) => a.label));
    expect(nav(table).some((a) => a.on)).toBe(false);
    for (const page of [pages["/"]!, pages["/build"]!, pages["/faq"]!, table]) expect(page).not.toContain('href="/build-the-table');
    expect(table).toContain('<meta name="robots" content="noindex">');
    expect(table.lastIndexOf('<meta name="robots"')).toBeLessThan(table.indexOf("</head>"));
    for (const page of [pages["/"]!, pages["/build"]!, pages["/faq"]!]) expect(page).not.toContain('name="robots"');
    // The shop links: the disclosure is on the page, and any Amazon link is marked as sponsored and opens apart.
    expect(table).toContain("as an Amazon Associate we earn from qualifying purchases");
    for (const [a] of table.matchAll(/<a\b[^>]*href="https:\/\/(?:www\.)?amazon\.[^"]*"[^>]*>/g)) expect(a, a).toMatch(/rel="sponsored[^"]*"/);
    expect(table.match(/class="tb-shot/g)).toHaveLength(10); // ten photos (some still to come), in a stack (D-330)
    expect(table).toContain('class="tb-hero"'); // and one as the banner
    // A page's own styles and script follow the shared ones; no page carries another's.
    const own = (page: string) => (page.match(/<style>/g)!.length > 1 ? cut(page, "<style>", "</style>", 1) : "");
    expect(own(pages["/"]!)).toContain(".hero-pin {");
    expect(own(pages["/build"]!)).toContain(".cards-stage {");
    expect(own(pages["/faq"]!)).toContain(".faq-group {");
    for (const path of ["/build", "/faq"]) for (const not of [".hero-pin", ".lightbox", 'id="lightbox"', "GAMES", "STEPS"]) expect(pages[path], `${path}: ${not}`).not.toContain(not);
    for (const path of ["/", "/faq"]) for (const not of [".cards-stage", ".slx-", "LINES", "#cards-pick"]) expect(pages[path], `${path}: ${not}`).not.toContain(not);
    for (const path of ["/", "/build"]) expect(pages[path], path).not.toContain(".faq-group");
    expect(pages["/faq"]!.split("<script>").length - 1, "the questions need no script of their own").toBe(1); // (counted, not matched: a pattern for script tags reads as a filter to the code scan)
    expect(pages["/"]).toContain('id="lightbox"'); // the close-up is where the games are
    expect(pages["/"]).toContain('location.replace("/build" + location.hash)'); // old links to parts that moved (D-312)
  });

  it("puts a page's file into the shell: title and description, its styles in the head, its script behind the foot (D-323)", () => {
    const shell = "<title>{{title}}</title><meta content=\"{{description}}\">{{style}}<header>{{nav}}{{admin}}</header><main>\n{{main}}\n</main><footer>{{version}}</footer>{{tail}}";
    const page = "<!--\ntitle: Q & A\ndescription: What people ask: and the answers\n-->\n<style>.x { color: red; }</style>\n<main>\n<p>costs $& nothing</p>\n</main>\n<script>let a = `${1}`;</script>\n";
    const html = assembleSitePage(shell, page, "/faq");
    expect(html).toContain("<title>Q &amp; A</title>");
    expect(html).toContain('<meta content="What people ask: and the answers">');
    expect(html).toContain("<main>\n<p>costs $& nothing</p>\n</main>"); // (the text as written: no "$" patterns of replace())
    expect(html.indexOf("<style>")).toBeLessThan(html.indexOf("<header>"));
    expect(html.endsWith("</footer><script>let a = `${1}`;</script>")).toBe(true);
    expect(html).toContain('<a class="on" href="/faq" aria-current="page">FAQ</a>');
    expect(html).toContain("{{admin}}"); // what a request decides stays open
    expect(html).toContain("{{version}}");
    // A file without its head comment, or without a title, is refused with its name.
    expect(() => assembleSitePage(shell, "<main>\n<p>x</p>\n</main>\n", "/faq")).toThrow(/site-pages\/faq\.html/);
    expect(() => assembleSitePage(shell, "<!--\ndescription: only this\n-->\n<main>\n<p>x</p>\n</main>\n", "/build")).toThrow(/site-pages\/build\.html: title/);
  });

  it("keeps the pages small: none as large as the one page for all was, the questions a fraction of the landing page (D-323)", async () => {
    await start();
    const size: Record<string, { text: number; gzip: number }> = {};
    for (const path of Object.keys(SITE_PAGES)) {
      const html = await (await get(path)).text();
      size[path] = { text: Buffer.byteLength(html), gzip: gzipSync(html).length };
    }
    // Before D-323 every page carried all styles and scripts: "/" 120 526 bytes (31 924 compressed), "/build" 115 822
    // (31 641), "/faq" 96 306 (26 111). Now: 102 435 (27 958), 66 179 (19 891), 29 502 (9 854). The bounds leave
    // room for new text, not for another page's parts.
    const most = { "/": { text: 112_000, gzip: 30_500 }, "/build": { text: 76_000, gzip: 23_000 }, "/faq": { text: 40_000, gzip: 13_000 } };
    for (const [path, max] of Object.entries(most)) {
      expect(size[path]!.text, `${path}: bytes`).toBeLessThan(max.text);
      expect(size[path]!.gzip, `${path}: bytes compressed`).toBeLessThan(max.gzip);
    }
    expect(size["/faq"]!.text).toBeLessThan(size["/"]!.text / 2);
    expect(size["/faq"]!.gzip).toBeLessThan(size["/"]!.gzip / 2);
    expect(size["/build"]!.text).toBeLessThan(size["/"]!.text);
  });
});
