// What a start can ask of the table's own screen (D-319): the screensaver, the pointer and the volume, for this start
// only. From the command line (the packages' starter, `npm run table -- --pointer off`) or the environment
// (TABLE_SCREENSAVER, TABLE_POINTER, TABLE_SOUND). Nothing here is saved: the board keeps only what is changed in its
// settings.

export interface ScreenOptions {
  /** Minutes without input until the screensaver shows; 0: no screensaver. */
  screensaver?: number;
  /** Whether the pointer shows on the board (and the deck beside it) in fullscreen. */
  pointer?: boolean;
  /** The volume of the table's screen in percent; 0: silent. */
  sound?: number;
}

const whole = (name: string, raw: string, max: number, what: string) => {
  const n = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || n > max) throw new Error(`--${name} needs ${what}`);
  return n;
};

/** The options as given (text); throws an Error that says what an option needs. Undefined when none is given. */
export function screenOptions(given: { screensaver?: string; pointer?: string; sound?: string }): ScreenOptions | undefined {
  const o: ScreenOptions = {};
  if (given.screensaver) o.screensaver = whole("screensaver", given.screensaver, 1440, "minutes (0 to 1440; 0 is off)");
  if (given.pointer) {
    const p = given.pointer.trim().toLowerCase();
    if (["on", "yes", "show", "true", "1"].includes(p)) o.pointer = true;
    else if (["off", "no", "hide", "false", "0"].includes(p)) o.pointer = false;
    else throw new Error("--pointer needs on or off");
  }
  if (given.sound) o.sound = whole("sound", given.sound, 100, "a level in percent (0 to 100; 0 is off)");
  return Object.keys(o).length ? o : undefined;
}

/** The help lines of these options, the same for the starter and the table host. */
export const SCREEN_OPTIONS_HELP = [
  "  --screensaver 10  the table's screen goes dark after 10 minutes without input; 0: never (default: what the",
  "                    board's settings say, an hour to begin with)",
  "  --pointer off     hide the mouse pointer on the board, and the deck beside it, in fullscreen (a touchscreen);",
  "                    --pointer on shows it (default: what the board's settings say, shown to begin with)",
  "  --sound 50        the volume of the table's screen in percent; 0: silent, 100: full (default: what the board's",
  "                    settings say, full to begin with)",
  "                    These three hold for this start and are not saved. The board's settings show them and can",
  "                    change them; only a change made there is kept.",
];
