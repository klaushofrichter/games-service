// Game rules for players (D-099): the Markdown subset the phones render, safety against markup and paths, the
// host serving how-to-play.md and images, the lobby state pointing at them, and every built-in game shipping rules.
import { mkdtemp, readdir, readFile, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// The renderer is the browser module itself: plain ESM with no DOM, so the tests run the code phones run.
import { renderRules } from "../apps/table-host/public/shared/markdown.js";
import { testHost } from "./helpers.ts";

const GAMES = join(import.meta.dirname, "..", "games");
const r = (md: string, base = "/games/g/") => renderRules(md, base).html;

describe("the rules renderer", () => {
  it("takes the first # heading as the title and renders the subset", () => {
    const out = renderRules(
      ["# Liar's Dice", "", "Bid **boldly**, call *carefully*, use `code`.", "", "## Turn", "1. Roll", "2. Bid", "", "- a", "- b", "", "> Tip: ones are wild.", "", "---", "### Small"].join("\n"),
      "/games/g/",
    );
    expect(out.title).toBe("Liar&#39;s Dice");
    expect(out.html).toContain("<p>Bid <strong>boldly</strong>, call <em>carefully</em>, use <code>code</code>.</p>");
    expect(out.html).toContain("<h3>Turn</h3>");
    expect(out.html).toContain("<ol><li>Roll</li><li>Bid</li></ol>");
    expect(out.html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(out.html).toContain("<blockquote>Tip: ones are wild.</blockquote>");
    expect(out.html).toContain("<hr>");
    expect(out.html).toContain("<h4>Small</h4>");
  });

  it("joins paragraph lines and continues list items on indented lines", () => {
    expect(r("one\ntwo\n\nthree")).toBe("<p>one two</p>\n<p>three</p>");
    expect(r("- first\n  more\n- second")).toBe("<ul><li>first more</li><li>second</li></ul>");
  });

  it("renders tables, padding short rows", () => {
    const html = r("| Setting | Default |\n|---|---|\n| Rounds | 3 |\n| Short |");
    expect(html).toContain("<th>Setting</th><th>Default</th>");
    expect(html).toContain("<tr><td>Rounds</td><td>3</td></tr>");
    expect(html).toContain("<tr><td>Short</td><td></td></tr>");
  });

  it("shows the game's own images from assets/, resolved against the game's folder", () => {
    expect(r("![The board](assets/board.svg)")).toBe('<p><img src="/games/g/assets/board.svg" alt="The board" loading="lazy"></p>');
    expect(r("![x](assets/sub/die-1.png)")).toContain('src="/games/g/assets/sub/die-1.png"');
  });

  it("refuses images from anywhere else: they stay as visible text", () => {
    for (const src of ["https://evil.example/x.png", "/shared/x.svg", "assets/../rules.ts", "assets/../../x.svg", "rules.ts", "assets/x.svg?y=1", "assets/.hidden.svg", "assets/x.html", "javascript:alert(1)", "data:image/svg+xml,<svg>"]) {
      const html = r(`![a](${src})`);
      expect(html, src).not.toContain("<img");
    }
  });

  it("links only to https, in a new tab", () => {
    expect(r("[site](https://example.com/a?b=1&c=2)")).toBe('<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">site</a></p>');
    for (const href of ["javascript:alert(1)", "http://example.com", "/admin", "data:text/html,x", "JaVaScRiPt:alert(1)"]) expect(r(`[x](${href})`), href).not.toContain("<a ");
  });

  it("escapes every bit of markup a rules file might contain", () => {
    const evil = [
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      "![x](assets/a.svg\" onerror=\"alert(1))",
      "[x](https://a.example/\" onmouseover=\"alert(1))",
      "**<b>bold</b>**",
      "| <i>cell</i> |\n|---|\n| <svg onload=alert(1)> |",
      "# <script>title</script>",
      "`<script>`",
      "> <iframe src=x>",
    ].join("\n\n");
    const { html, title } = renderRules(evil, "/games/g/");
    // The only tags in the output are the renderer's own; everything from the file is escaped text.
    const tags = new Set([...(html + title).matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1]));
    for (const tag of tags) expect(["p", "strong", "em", "code", "table", "thead", "tbody", "tr", "th", "td", "div", "blockquote", "h2", "h3", "h4"], tag).toContain(tag);
    expect(html).not.toMatch(/<[a-z]+[^>]*\son\w+=/); // no event handler inside any real tag
    expect(title).toBe("&lt;script&gt;title&lt;/script&gt;");
    expect(html).toContain("<code>&lt;script&gt;</code>");
  });

  it("doesn't mistake bold, rules or emphasis for lists, and keeps underscores in words", () => {
    expect(r("**Bold** start")).toBe("<p><strong>Bold</strong> start</p>");
    expect(r("***")).toBe("<hr>");
    expect(r("snake_case_name stays")).toBe("<p>snake_case_name stays</p>");
    expect(r("2 * 3 * 4")).toBe("<p>2 * 3 * 4</p>");
  });

  it("handles empty and odd input", () => {
    expect(renderRules("", "/x/")).toEqual({ title: "", html: "" });
    expect(renderRules(undefined as unknown as string, "/x/")).toEqual({ title: "", html: "" });
    expect(r("\r\n\r\ntext\r\n")).toBe("<p>text</p>");
  });
});

describe("every built-in game ships rules", () => {
  it("each game has how-to-play.md with a title, sections, a settings table naming its settings, and working images", async () => {
    const ids = (await readdir(GAMES, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    for (const id of ids) {
      const md = await readFile(join(GAMES, id, "how-to-play.md"), "utf8");
      const manifest = JSON.parse(await readFile(join(GAMES, id, "manifest.json"), "utf8"));
      const { title, html } = renderRules(md, `/games/${id}/`);
      expect(title, id).toBeTruthy();
      expect(html, id).toContain("<h3>");
      // Every image reference was accepted (nothing left as text) and points at a real file.
      expect(html, id).not.toMatch(/!\[/);
      for (const [, src] of html.matchAll(/<img src="\/games\/[^/]+\/([^"]+)"/g)) expect(existsSync(join(GAMES, id, src)), `${id}: ${src}`).toBe(true);
      // The settings table uses the manifest's labels, so players can match it to the board's settings.
      for (const s of manifest.settings) expect(md, `${id}: ${s.label}`).toContain(s.label);
    }
  });

  it("the illustrations are well-formed SVG with no script, links or foreign content", async () => {
    for (const id of await readdir(GAMES)) {
      const dir = join(GAMES, id, "assets");
      if (!existsSync(dir)) continue;
      for (const f of (await readdir(dir)).filter((x) => x.endsWith(".svg"))) {
        const svg = await readFile(join(dir, f), "utf8");
        expect(svg, f).toMatch(/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/);
        expect(svg, f).toMatch(/<\/svg>\s*$/);
        for (const bad of [/<script/i, /<foreignObject/i, /\son\w+=/i, /href="(?!#)/i, /<image/i]) expect(svg, `${f} ${bad}`).not.toMatch(bad);
        expect(svg.length, f).toBeLessThan(40_000);
      }
    }
  });
});

describe("the host serves rules", () => {
  let t: Awaited<ReturnType<typeof testHost>>;
  let dir: string;
  beforeEach(async () => {
    // Coin Flip twice: as itself, and as a copy without rules.
    // Inside the repository, one level down, so the games' relative SDK imports (../../packages) still resolve.
    dir = await mkdtemp(join(import.meta.dirname, "..", ".tmp-rules-"));
    await cp(join(GAMES, "coin-flip"), join(dir, "coin-flip"), { recursive: true });
    await cp(join(GAMES, "coin-flip"), join(dir, "plain-flip"), { recursive: true });
    await rm(join(dir, "plain-flip", "how-to-play.md"));
    const m = JSON.parse(await readFile(join(dir, "plain-flip", "manifest.json"), "utf8"));
    await (await import("node:fs/promises")).writeFile(join(dir, "plain-flip", "manifest.json"), JSON.stringify({ ...m, id: "plain-flip", name: "Plain Flip" }));
    t = await testHost({ gamesDir: dir });
  });
  afterEach(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("lists where each game's rules are, or null", async () => {
    const games = await t.ok("GET", "/games");
    expect(games.find((g: { id: string }) => g.id === "coin-flip").howToPlay).toBe("/games/coin-flip/how-to-play.md");
    expect(games.find((g: { id: string }) => g.id === "plain-flip").howToPlay).toBeNull();
  });

  it("puts the chosen game's rules and its settings, with labels, into the lobby state", async () => {
    await t.joinDeck("Ann");
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 5 } });
    const g = (await t.ok("GET", "/state")).game;
    expect(g.howToPlay).toBe("/games/coin-flip/how-to-play.md");
    expect(g.settingsShown).toEqual([
      { label: "Rounds", value: 5 },
      { label: "Seconds to guess (0 = no limit)", value: 15 },
    ]);
    // A deck sees the same state.
    const d = t.decks[0];
    expect((await d.waitState((s) => s.game?.id === "coin-flip")).game!.howToPlay).toBe("/games/coin-flip/how-to-play.md");
    await t.ok("POST", "/game/select", { gameId: "plain-flip" });
    expect((await t.ok("GET", "/state")).game.howToPlay).toBeNull();
  });

  it("serves the rules as Markdown and images as data that can't run script, to anyone on the LAN", async () => {
    const md = await fetch(`${t.base}/games/coin-flip/how-to-play.md`);
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(md.headers.get("x-content-type-options")).toBe("nosniff");
    expect(md.headers.get("content-security-policy")).toContain("sandbox");
    expect(await md.text()).toMatch(/^# /);
    const svg = await fetch(`${t.base}/games/coin-flip/assets/round.svg`);
    expect(svg.status).toBe(200);
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(svg.headers.get("content-security-policy")).toContain("default-src 'none'");
    // The game's own code keeps working: board.js is not sandboxed.
    const js = await fetch(`${t.base}/games/coin-flip/board.js`);
    expect(js.headers.get("content-security-policy")).toBeNull();
  });

  it("serves nothing else from the game folder", async () => {
    for (const p of ["plain-flip/how-to-play.md", "coin-flip/rules.ts", "coin-flip/manifest.json", "coin-flip/HOW-TO-PLAY.md", "coin-flip/how-to-play.md.bak", "coin-flip/assets/../rules.ts", "nope/how-to-play.md"])
      expect((await fetch(`${t.base}/games/${p}`)).status, p).toBe(404);
  });
});
