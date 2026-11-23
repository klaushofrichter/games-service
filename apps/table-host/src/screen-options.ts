// What a start can ask of the table's own screen (D-319): the screensaver, the pointer and the volume, for this start
// only. From the command line (the packages' starter, `npm run table -- --pointer off`) or the environment
// (TABLE_SCREENSAVER, TABLE_POINTER, TABLE_SOUND, TABLE_KIOSK). Nothing here is saved: the board keeps only what is changed in its
// settings.

export interface ScreenOptions {
  /** Minutes without input until the screensaver shows; 0: no screensaver. */
  screensaver?: number;
  /** Whether the pointer shows on the board (and the deck beside it) in fullscreen. */
  pointer?: boolean;
  /** The volume of the table's screen in percent; 0: silent. */
  sound?: number;
  /** The board's browser shows nothing but the board (a kiosk): the board is full screen without asking for it. */
  kiosk?: boolean;
}

const whole = (name: string, raw: string, max: number, what: string) => {
  const n = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || n > max) throw new Error(`--${name} needs ${what}`);
  return n;
};
const onOff = (name: string, raw: string) => {
  const p = raw.trim().toLowerCase();
  if (["on", "yes", "show", "true", "1"].includes(p)) return true;
  if (["off", "no", "hide", "false", "0"].includes(p)) return false;
  throw new Error(`--${name} needs on or off`);
};

/**
 * The options, each once: its name on the command line (`--name value`, or `--name` alone for a `flag`), its name in
 * the environment, and how its text is read. The table host, the packages' starter and the tests go by this list, so
 * another option is one more line here (and what the board does with it).
 */
export const SCREEN_OPTIONS = [
  { name: "screensaver", env: "TABLE_SCREENSAVER", flag: false, read: (v: string) => whole("screensaver", v, 1440, "minutes (0 to 1440; 0 is off)") },
  { name: "pointer", env: "TABLE_POINTER", flag: false, read: (v: string) => onOff("pointer", v) },
  { name: "sound", env: "TABLE_SOUND", flag: false, read: (v: string) => whole("sound", v, 100, "a level in percent (0 to 100; 0 is off)") },
  { name: "kiosk", env: "TABLE_KIOSK", flag: true, read: (v: string) => (v === "1" ? true : undefined) },
] as const;
export type ScreenOptionName = (typeof SCREEN_OPTIONS)[number]["name"];
/** The options as given: text, as on the command line or in the environment (a flag that is set: "1"). */
export type ScreenOptionsGiven = Partial<Record<ScreenOptionName, string>>;

/** The options read; throws an Error that says what an option needs. Undefined when none is given. */
export function screenOptions(given: ScreenOptionsGiven): ScreenOptions | undefined {
  const o: Record<string, unknown> = {};
  for (const opt of SCREEN_OPTIONS) {
    const text = given[opt.name];
    const v = text ? opt.read(text) : undefined;
    if (v !== undefined) o[opt.name] = v;
  }
  return Object.keys(o).length ? (o as ScreenOptions) : undefined;
}

/** The options of a command line and an environment (the table host's own start); the command line wins. */
export function screenOptionsGiven(argv: string[], env: Record<string, string | undefined>): ScreenOptionsGiven {
  const given: ScreenOptionsGiven = {};
  for (const opt of SCREEN_OPTIONS) {
    const i = argv.findIndex((a) => a === `--${opt.name}` || a.startsWith(`--${opt.name}=`));
    const told = i < 0 ? undefined : opt.flag ? "1" : argv[i]!.includes("=") ? argv[i]!.slice(argv[i]!.indexOf("=") + 1) : argv[i + 1];
    const text = told ?? env[opt.env];
    if (text) given[opt.name] = text;
  }
  return given;
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
  "  --kiosk           the board's browser shows nothing but the board: the board counts as full screen (the",
  "                    pointer hides with --pointer off; no Fullscreen button)",
];
