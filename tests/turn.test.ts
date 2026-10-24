// TURN relays from Cloudflare (D-209): short-lived credentials fetched by the service, kept and renewed, port 53 left
// out, and plain STUN whenever Cloudflare can't help.
import { afterEach, describe, expect, it, vi } from "vitest";
import { iceProvider } from "../apps/cloud/src/turn.ts";

const STUN = [{ urls: "stun:stun.l.google.com:19302" }];
const ANSWER = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turn:turn.cloudflare.com:3478?transport=tcp", "turns:turn.cloudflare.com:443?transport=tcp"],
      username: "u1",
      credential: "c1",
    },
  ],
};

/** A fake Cloudflare: answers with `body` (or fails), and records each request. */
function fakeCloudflare(answers: (() => Response | Promise<Response>)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    return next();
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 201, headers: { "content-type": "application/json" } });

afterEach(() => vi.useRealTimers());

describe("Cloudflare TURN credentials", () => {
  it("without a key: the STUN list, no request", async () => {
    expect(await iceProvider(STUN, null)()).toBe(STUN);
  });

  it("asks Cloudflare with the key's token for a day's credentials, leaves port 53 out, and keeps them", async () => {
    const cf = fakeCloudflare([ok(ANSWER)]);
    const ice = iceProvider(STUN, { keyId: "key/1", apiToken: "tok", fetch: cf.f }, () => {});
    const servers = await ice();
    expect(cf.calls).toHaveLength(1);
    expect(cf.calls[0].url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key%2F1/credentials/generate-ice-servers");
    expect(cf.calls[0].init.method).toBe("POST");
    expect((cf.calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(cf.calls[0].init.body))).toEqual({ ttl: 86400 });
    expect(servers).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
      { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:3478?transport=tcp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u1", credential: "c1" },
    ]);
    await ice();
    await ice();
    expect(cf.calls).toHaveLength(1); // kept
  });

  it("renews them when less than half their life is left, and keeps the old ones if renewing fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const cf = fakeCloudflare([ok(ANSWER), () => new Response("nope", { status: 500 })]);
    const logs: string[] = [];
    const ice = iceProvider(STUN, { keyId: "k", apiToken: "t", fetch: cf.f }, (m) => logs.push(m));
    await ice();
    vi.advanceTimersByTime(11 * 3600_000);
    await ice();
    expect(cf.calls).toHaveLength(1); // still more than 12 hours left
    vi.advanceTimersByTime(2 * 3600_000);
    const servers = await ice(); // renewing fails: the current ones are still valid
    expect(cf.calls).toHaveLength(2);
    expect(servers[1].credential).toBe("c1");
    expect(logs.at(-1)).toMatch(/HTTP 500; keeping the current ones/);
    vi.advanceTimersByTime(30_000);
    await ice();
    expect(cf.calls).toHaveLength(2); // a minute between attempts
    vi.advanceTimersByTime(12 * 3600_000); // expired, Cloudflare still down
    expect(await ice()).toBe(STUN);
  });

  it("falls back to STUN when Cloudflare can't be reached or answers without a TURN server", async () => {
    const down = fakeCloudflare([() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))]);
    const logs: string[] = [];
    expect(await iceProvider(STUN, { keyId: "k", apiToken: "t", fetch: down.f }, (m) => logs.push(m))()).toBe(STUN);
    expect(logs[0]).toMatch(/ENOTFOUND; using STUN only/);
    const empty = fakeCloudflare([ok({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] })]);
    expect(await iceProvider(STUN, { keyId: "k", apiToken: "t", fetch: empty.f }, () => {})()).toBe(STUN);
  });

  it("asks once for connections that arrive together", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const cf = fakeCloudflare([async () => (await gate, ok(ANSWER)())]);
    const ice = iceProvider(STUN, { keyId: "k", apiToken: "t", fetch: cf.f }, () => {});
    const both = Promise.all([ice(), ice()]);
    release();
    const [a, b] = await both;
    expect(cf.calls).toHaveLength(1);
    expect(a).toEqual(b);
  });
});
