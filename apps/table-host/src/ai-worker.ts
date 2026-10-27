// A game's AI in a worker thread (D-112): loads the game's rules module and answers one move at a time. The host
// sends the seat's view and options as plain data and terminates the worker when the game moves on mid-thought,
// since a long synchronous search cannot be interrupted any other way.
import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { registerSdkHook } from "./games.ts";
import { createRng, type GameDefinition } from "../../../packages/sdk/src/index.ts";
import { randomContext } from "./random-context.ts";

registerSdkHook();
const def = (await import(pathToFileURL(workerData.rulesFile as string).href)).default as GameDefinition;

export interface WorkerRequest {
  id: number;
  view: unknown;
  seat: number;
  options: Record<string, unknown>;
  seed: number;
  deadline: number;
}

parentPort!.on("message", async (m: WorkerRequest) => {
  const ctx = {
    ...randomContext(createRng(m.seed)),
    signal: new AbortController().signal, // the host stops a stale search by terminating the thread
    deadline: m.deadline,
  };
  try {
    const intent = def.ai ? await def.ai(m.view, m.seat, ctx, m.options) : null;
    parentPort!.postMessage({ id: m.id, intent: intent ?? null });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: (e as Error)?.message ?? String(e) });
  }
});
parentPort!.postMessage({ ready: true });
