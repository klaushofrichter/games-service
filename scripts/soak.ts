// Soak test: many AI-only games per installed game; checks every game finishes, replays exactly,
// and (for point games) conserves points. Usage: node scripts/soak.ts [gamesPerConfig]
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGames } from "../apps/table-host/src/games.ts";
import { LogStore } from "../apps/table-host/src/logs.ts";
import { replay } from "../apps/table-host/src/runtime.ts";
import { runSimulation } from "../apps/table-host/src/simulation.ts";
import { allowedPlayerCounts } from "../packages/protocol/src/index.ts";

const perConfig = Number(process.argv[2] ?? 100);
const games = await loadGames(join(import.meta.dirname, "..", "games"));
const logs = new LogStore(await mkdtemp(join(tmpdir(), "soak-")));
let failures = 0;

for (const g of games.values()) {
  if (!g.manifest.simulation.supported) continue;
  const styles = g.manifest.ai.options[0]?.values ?? [undefined];
  for (const players of allowedPlayerCounts(g.manifest)) {
    const t0 = Date.now();
    const aiOptions = Array.from({ length: players }, (_, i) => (styles[i % styles.length] ? { [g.manifest.ai.options[0].key]: styles[i % styles.length] } : {}));
    const settings = g.manifest.id === "holdem" ? { hands: 40 } : {};
    const r = await runSimulation(g, { players, games: perConfig, seed: players * 1000 + 7, aiOptions, settings }, logs, "soak");
    const { games: recs } = await LogStore.unzip((await logs.read(r.logId))!);
    let bad = 0;
    const winners: Record<string, number> = {};
    recs.forEach((log, i) => {
      const end = log.at(-1) as any;
      if (r.games[i].reason !== "finished") bad++;
      if (replay(g.manifest, g.def, log) !== end.stateHash) bad++;
      const h = end.summary?.highlights ?? {};
      if (g.manifest.id === "holdem") {
        const total = Object.values(h.stacks as Record<string, number>).reduce((a, b) => a + b, 0);
        if (total !== players * 500) bad++;
      }
      for (const w of [].concat(h.winners ?? h.winner ?? [])) winners[w] = (winners[w] ?? 0) + 1;
    });
    failures += bad;
    const steps = r.games.reduce((a, x) => a + x.steps, 0);
    console.log(`${g.manifest.id.padEnd(10)} ${players} players  ${perConfig} games  ${steps} steps  ${Date.now() - t0} ms  ${bad ? `FAILED ${bad}` : "ok"}  wins ${JSON.stringify(winners)}`);
  }
}
console.log(failures ? `\n${failures} problems` : "\nall games finished, replayed exactly and conserved points");
process.exit(failures ? 1 : 0);
