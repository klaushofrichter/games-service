// The developer guide (D-160) stays in step with the code: every rules hook, every manifest field and every field the
// UI modules get in `info` is documented in docs/developers/game-development.md, and llms.txt points to it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manifestSchema } from "../packages/protocol/src/index.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const guide = read("docs/developers/game-development.md");

describe("the developer guide (D-160)", () => {
  it("documents every hook of GameDefinition", () => {
    const sdk = read("packages/sdk/src/index.ts");
    const body = sdk.slice(sdk.indexOf("export interface GameDefinition"), sdk.indexOf("export function defineGame"));
    const hooks = [...body.matchAll(/^\s{2}(\w+)\??\(/gm)].map((m) => m[1]);
    expect(hooks).toContain("onSeatChanged");
    for (const h of hooks) expect(guide, h).toMatch(new RegExp(`\`${h}\\b`));
  });

  it("documents every manifest field", () => {
    for (const key of Object.keys(manifestSchema.shape)) expect(guide, key).toMatch(new RegExp(`\`${key}\``));
  });

  it("documents every field the board and phone modules get in info", () => {
    const fields = (file: string, fn: string) => {
      const src = read(file);
      const start = src.indexOf(`function ${fn}() {`);
      const body = src.slice(start, src.indexOf("\n}\n", start));
      return [...body.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
    };
    const board = fields("apps/table-host/public/board/board.js", "gameInfo");
    const deck = fields("apps/table-host/public/deck/deck.js", "info");
    expect(board.length).toBeGreaterThan(10);
    for (const f of [...board, ...deck, "viewEdge", "boardEdge"]) expect(guide, f).toMatch(new RegExp(`\`${f}\``));
  });

  it("llms.txt follows llmstxt.org and points to the guide, naming no private repository", () => {
    const llms = read("llms.txt");
    expect(llms).toMatch(/^# Game Table\n\n> .+\n/);
    expect(llms).toContain("/docs/game-development.md");
    for (const t of [llms, guide]) expect(t).not.toMatch(/loopy|starforge|extra-games/i);
  });
});
