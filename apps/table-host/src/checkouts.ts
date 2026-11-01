// Where a table's games come from when they are git checkouts on this computer (D-251): a table started by
// scripts/local-table.sh runs the game folders of local clones, at whatever branch they are on, not the games the
// service delivers from GitHub. The board says so once, with the branches.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { InstalledGame } from "./games.ts";

const run = promisify(execFile);

export interface Checkout {
  /** The checkout's folder name, e.g. "games-service". */
  name: string;
  /** Its branch, or "detached" at a commit. */
  branch: string;
  /** The commit checked out, short. */
  commit: string;
  /** Changes not committed (tracked files): the games run code no commit holds. */
  changed: boolean;
  /** The ids of the games from it. */
  games: string[];
}

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", dir, ...args], { timeout: 5000 });
  return stdout.trim();
}

/**
 * The git checkouts the games were loaded from, one entry each, in the order found. Games delivered by the service
 * (`source`) don't count, nor folders outside any checkout (a table's image has no .git). Never throws: without git
 * or a checkout, the list is empty.
 */
export async function checkoutsOf(games: Map<string, InstalledGame>): Promise<Checkout[]> {
  const byRoot = new Map<string, Checkout>();
  for (const g of games.values()) {
    if (g.source) continue;
    try {
      const dir = await realpath(g.dir);
      const root = await git(dir, "rev-parse", "--show-toplevel");
      let c = byRoot.get(root);
      if (!c) {
        const [branch, commit, status] = await Promise.all([
          git(root, "rev-parse", "--abbrev-ref", "HEAD"),
          git(root, "rev-parse", "--short", "HEAD"),
          git(root, "status", "--porcelain", "--untracked-files=no"),
        ]);
        c = { name: basename(root), branch: branch === "HEAD" ? "detached" : branch, commit, changed: status !== "", games: [] };
        byRoot.set(root, c);
      }
      c.games.push(g.manifest.id);
    } catch {
      // not in a checkout, or no git: nothing to say
    }
  }
  return [...byRoot.values()];
}
