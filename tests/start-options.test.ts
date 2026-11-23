// The start's options for the table's screen (--screensaver, --pointer, --sound; D-319): what they accept, how they
// reach the board (the lobby state, never a saved setting), and that every option of the starter is in its help and
// in the three installation guides.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCREEN_OPTIONS, screenOptions, screenOptionsGiven } from "../apps/table-host/src/screen-options.ts";
import { kioskArgs, kioskBrowser, parseArgs, readmeText } from "../scripts/package/launch.ts";
import { testHost } from "./helpers.ts";

describe("the options for the table's screen", () => {
  it("reads minutes, on or off, and percent", () => {
    expect(screenOptions({})).toBeUndefined();
    expect(screenOptions({ screensaver: "10", pointer: "off", sound: "50" })).toEqual({ screensaver: 10, pointer: false, sound: 50 });
    expect(screenOptions({ screensaver: "0", sound: "0" })).toEqual({ screensaver: 0, sound: 0 });
    for (const [word, shown] of [["on", true], ["yes", true], ["show", true], ["OFF", false], ["no", false], ["hide", false]] as const) {
      expect(screenOptions({ pointer: word })).toEqual({ pointer: shown });
    }
  });

  it("refuses what it can't read, and says what the option needs", () => {
    expect(() => screenOptions({ screensaver: "soon" })).toThrow(/--screensaver needs minutes/);
    expect(() => screenOptions({ screensaver: "-5" })).toThrow(/--screensaver/);
    expect(() => screenOptions({ screensaver: "1.5" })).toThrow(/--screensaver/);
    expect(() => screenOptions({ pointer: "maybe" })).toThrow(/--pointer needs on or off/);
    expect(() => screenOptions({ sound: "101" })).toThrow(/--sound needs a level in percent/);
    expect(() => screenOptions({ sound: "loud" })).toThrow(/--sound/);
  });
});

describe("a table started with them", () => {
  let t: Awaited<ReturnType<typeof testHost>> | undefined;
  afterEach(async () => { await t?.close(); t = undefined; });

  it("tells its board, with a mark of this start; a table started without says nothing", async () => {
    t = await testHost({ screen: { screensaver: 10, pointer: false, sound: 50, kiosk: true } });
    const { screen } = await t.ok("GET", "/state");
    expect(screen).toMatchObject({ screensaver: 10, pointer: false, sound: 50, kiosk: true });
    expect(typeof screen.start).toBe("number");
    await t.close();
    t = await testHost();
    expect((await t.ok("GET", "/state")).screen).toBeUndefined();
  });
});

describe("the starter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("takes the three options, in either spelling", () => {
    expect(parseArgs(["--screensaver", "10", "--pointer=off", "--sound", "50"]).screen).toEqual({ screensaver: "10", pointer: "off", sound: "50" });
    expect(parseArgs([]).screen).toEqual({});
  });

  it("--kiosk: a flag, said to the board, and a browser that shows nothing but the board (D-324)", () => {
    expect(parseArgs(["--kiosk", "--pointer", "off"]).screen).toEqual({ kiosk: "1", pointer: "off" });
    expect(screenOptions({ kiosk: "1" })).toEqual({ kiosk: true });
    expect(screenOptions({})).toBeUndefined();
    // The table host's own start: its command line, then its environment.
    expect(screenOptionsGiven(["--kiosk", "--sound=30"], { TABLE_SOUND: "80", TABLE_POINTER: "off" })).toEqual({ kiosk: "1", sound: "30", pointer: "off" });
    const args = kioskArgs("http://localhost:8080/board/", "/home/x/kiosk-browser");
    expect(args[0]).toBe("--kiosk");
    expect(args).toContain("--user-data-dir=/home/x/kiosk-browser"); // a profile of its own: no window of the person's browser
    expect(args.at(-1)).toBe("http://localhost:8080/board/");
    // The browser: the one named, or none when that is not there (the board then opens as usual).
    vi.stubEnv("GAME_TABLE_BROWSER", process.execPath);
    expect(kioskBrowser()).toBe(process.execPath);
    vi.stubEnv("GAME_TABLE_BROWSER", "/no/such/browser");
    expect(kioskBrowser()).toBeNull();
    vi.unstubAllEnvs();
  });

  it("stops at a value it can't read", () => {
    const said: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m: string) => void said.push(m));
    vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    expect(() => parseArgs(["--pointer", "maybe"])).toThrow("exit");
    expect(said.join("\n")).toMatch(/--pointer needs on or off/);
  });

  it("names every option in --help and in the three guides", () => {
    const options = [...readFileSync(new URL("../scripts/package/launch.ts", import.meta.url), "utf8").matchAll(/^\s+case "([a-z]+)":/gm)].map((m) => m[1]).filter((o) => !["v", "h", "?"].includes(o)).concat(SCREEN_OPTIONS.map((o) => o.name));
    expect(options).toContain("screensaver");
    const squash = (s: string) => [...s.matchAll(/--([a-z-]+)/g)].map((m) => m[1].replace(/-/g, ""));
    const help = squash(readmeText());
    expect(options.filter((o) => !help.includes(o))).toEqual([]);
    for (const os of ["linux", "macos", "windows"]) {
      const guide = readFileSync(new URL(`../docs/install/${os}.md`, import.meta.url), "utf8");
      const table = squash(guide.slice(guide.indexOf("\n## Options")));
      expect(options.filter((o) => !table.includes(o)), os).toEqual([]);
    }
  });
});
