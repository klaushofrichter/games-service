// Hardening found by the review of D-202: the cloud's token compare, uploaded logs that inflate too far, and the sling
// gesture a phone may pass to the boards.
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { same } from "../apps/cloud/src/auth.ts";
import { readRunMeta } from "../apps/cloud/src/log-meta.ts";
import { cleanGesture } from "../apps/table-host/src/server.ts";

describe("security hardening (D-202)", () => {
  it("compares secrets as bytes and never throws", () => {
    expect(same("abc", "abc")).toBe(true);
    expect(same("abd", "abc")).toBe(false);
    // Same length in characters, more bytes: timingSafeEqual would throw on the byte lengths.
    expect(() => same("abé", "abc")).not.toThrow();
    expect(same("abé", "abc")).toBe(false);
    expect(same(undefined, "abc")).toBe(false);
  });

  it("reads run.json from an upload, but not one that inflates past 1 MB (a zip bomb)", async () => {
    const ok = new JSZip();
    ok.file("run.json", JSON.stringify({ gameId: "coin-flip" }));
    expect((await readRunMeta(await ok.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }))).gameId).toBe("coin-flip");
    const bomb = new JSZip();
    bomb.file("run.json", `{"gameId":"coin-flip","pad":"${"x".repeat(50_000_000)}"}`);
    const zip = await bomb.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    expect(zip.length).toBeLessThan(1_000_000); // small to upload, 50 MB inflated
    expect(await readRunMeta(zip)).toEqual({});
  });

  it("passes only the sling's own fields of a gesture to the boards", () => {
    expect(cleanGesture({ id: "12", f: 0.4, x: -0.2, a: 3, extra: "<b>" })).toEqual({ id: "12", f: 0.4, x: -0.2, a: 3 });
    expect(cleanGesture({ id: 7, end: true })).toEqual({ id: 7, end: true });
    // Markup or long strings in the item go; short plain values stay.
    const g = cleanGesture({ id: "1", item: { c: "r", k: "7", n: 2, wild: false, html: "x".repeat(41), "bad key": 1, nested: { a: 1 } } });
    expect(g).toEqual({ id: "1", item: { c: "r", k: "7", n: 2, wild: false } });
    expect(cleanGesture({ f: Number.NaN, x: "1", a: Infinity })).toEqual({});
    for (const bad of [null, "text", 3, [1, 2]]) expect(cleanGesture(bad)).toBeNull();
    expect(cleanGesture({ id: "x".repeat(65) })).toEqual({});
  });
});
