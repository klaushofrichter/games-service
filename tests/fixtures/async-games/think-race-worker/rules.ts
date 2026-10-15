// The Think Race test game with its AI in a worker thread (D-112, manifest `ai.worker`). `behaviour` "busy" thinks
// with a synchronous loop for `thinkMs`, which only terminating the thread can stop; "hang" loops for ever.
import { defineGame, type Intent } from "@game-table/sdk";
import base from "../think-race/rules.ts";

export default defineGame({
  ...base,
  ai(view, seat, ctx, options): Intent | null | Promise<Intent | null> {
    if (options.behaviour === "busy" || options.behaviour === "hang") {
      const until = options.behaviour === "hang" ? Infinity : Date.now() + Number(options.thinkMs);
      while (Date.now() < until) {
        // thinking hard, in this thread only
      }
      return { name: "add", payload: { n: 1 } };
    }
    return base.ai!(view, seat, ctx, options);
  },
});
