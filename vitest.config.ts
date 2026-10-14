import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sdk = (f: string) => fileURLToPath(new URL(`./packages/sdk/src/${f}`, import.meta.url));

export default defineConfig({
  // Vitest resolves imports itself, so extra games' `@game-table/sdk` needs the same mapping as the host's hook (D-097).
  resolve: { alias: [{ find: /^@game-table\/sdk\/cards$/, replacement: sdk("cards.ts") }, { find: /^@game-table\/sdk$/, replacement: sdk("index.ts") }] },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
