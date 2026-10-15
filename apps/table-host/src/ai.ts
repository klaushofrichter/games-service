// AI players that take their time (D-112): an AI may answer with a promise, or run in a worker thread
// (manifest `ai.worker`), so a deep search or a call to a language model never blocks the table.
import { Worker } from "node:worker_threads";
import type { Intent } from "../../../packages/sdk/src/index.ts";
import type { InstalledGame } from "./games.ts";
import type { GameRuntime } from "./runtime.ts";

export class AiCancelled extends Error {
  constructor() {
    super("the AI's move was cancelled");
  }
}

/**
 * One AI player's worker thread. It thinks about one move at a time; `cancel()` terminates the thread when the game
 * moves on mid-thought (a synchronous search cannot be stopped otherwise), and the next move starts a fresh one.
 */
export class AiWorker {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private pending: { id: number; resolve: (i: Intent | null) => void; reject: (e: Error) => void } | null = null;
  private nextId = 1;
  private readonly rulesFile: string;

  constructor(rulesFile: string) {
    this.rulesFile = rulesFile;
  }

  get busy() {
    return this.pending !== null;
  }

  private start() {
    const w = new Worker(new URL("./ai-worker.ts", import.meta.url), { workerData: { rulesFile: this.rulesFile } });
    this.worker = w;
    this.ready = new Promise((resolve, reject) => {
      const onMessage = (m: { ready?: boolean }) => {
        if (m?.ready) {
          w.off("message", onMessage);
          resolve();
        }
      };
      w.on("message", onMessage);
      w.once("error", reject);
    });
    this.ready.catch(() => {}); // reported through decide()
    w.on("message", (m: { id?: number; intent?: Intent | null; error?: string }) => {
      if (m?.id === undefined || this.pending?.id !== m.id) return;
      const p = this.pending;
      this.pending = null;
      if (m.error !== undefined) p.reject(new Error(m.error));
      else p.resolve(m.intent ?? null);
    });
    w.on("error", (e: Error) => this.fail(w, e));
    w.on("exit", () => this.fail(w, new Error("the AI's worker thread stopped")));
    w.unref();
  }

  private fail(w: Worker, e: Error) {
    if (this.worker !== w) return;
    this.worker = null;
    this.ready = null;
    const p = this.pending;
    this.pending = null;
    p?.reject(e);
  }

  async decide(view: unknown, seat: number, options: Record<string, unknown>, seed: number, deadline: number): Promise<Intent | null> {
    if (this.pending) this.cancel();
    if (!this.worker) this.start();
    const w = this.worker!;
    await this.ready;
    if (this.worker !== w) throw new AiCancelled();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      w.postMessage({ id, view, seat, options, seed, deadline });
    });
  }

  /** Stop a move in progress: the thread is terminated and the caller's promise rejects with AiCancelled. */
  cancel() {
    if (!this.pending && this.worker) return; // idle: keep the thread (and its loaded rules) for the next move
    const p = this.pending;
    this.pending = null;
    const w = this.worker;
    this.worker = null;
    this.ready = null;
    void w?.terminate();
    p?.reject(new AiCancelled());
  }

  terminate() {
    const w = this.worker;
    this.worker = null;
    this.ready = null;
    const p = this.pending;
    this.pending = null;
    void w?.terminate();
    p?.reject(new AiCancelled());
  }
}

/**
 * Ask a seat's AI for its move: in this thread (the answer may be a promise) or, with `ai.worker`, in the seat's worker
 * thread. `rng` is the seat's AI randomness; a worker gets one number drawn from it as its seed.
 */
export function aiMove(
  game: InstalledGame,
  rt: GameRuntime,
  seat: number,
  rng: () => number,
  signal: AbortSignal,
  deadline: number,
  worker: AiWorker | null,
): Intent | null | Promise<Intent | null> {
  if (!game.def.ai || rt.over) return null;
  if (worker) return worker.decide(rt.view(seat), seat, rt.aiOptions(seat), Math.floor(rng() * 2 ** 31), deadline);
  return rt.aiDecide(seat, rng, signal, deadline);
}

/** Whether the game's AI runs in a worker thread (it needs a rules file to load there). */
export function usesWorker(game: InstalledGame): boolean {
  return !!game.manifest.ai.worker && !!game.rulesFile;
}

export const isPromise = <T>(v: unknown): v is Promise<T> => typeof (v as { then?: unknown })?.then === "function";
