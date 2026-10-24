// Cloud service entry point. Configuration comes from environment variables; in the cluster they come from the
// games-oauth Secret (see scripts/sync-secrets.sh) and the Deployment's env.
import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startCloud } from "./server.ts";
import { parseRepoConfig } from "./game-repos.ts";
import type { GoogleAuthOptions } from "./auth.ts";

const env = process.env;
const fail = (msg: string) => {
  console.error(`[cloud] ${msg}`);
  process.exit(1);
};
const publicUrl = env.PUBLIC_URL ?? "https://games.skylar.technology";

// ADMIN_TOKEN is optional: a bearer token for scripts and pipelines. People sign in with Google.
const adminToken = env.ADMIN_TOKEN || undefined;
if (adminToken && adminToken.length < 16) fail("ADMIN_TOKEN must be at least 16 characters (or unset)");

const googleKeys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "ALLOWED_EMAILS", "COOKIE_SECRET"] as const;
const present = googleKeys.filter((k) => env[k]);
let google: GoogleAuthOptions | null = null;
if (present.length) {
  const missing = googleKeys.filter((k) => !env[k]);
  if (missing.length) fail(`Google sign-in is half configured; missing ${missing.join(", ")}`);
  if (env.COOKIE_SECRET!.length < 32) fail("COOKIE_SECRET must be at least 32 characters (openssl rand -hex 32)");
  const expected = `${publicUrl}/auth/google/callback`;
  if (env.GOOGLE_REDIRECT_URI !== expected) fail(`GOOGLE_REDIRECT_URI must be ${expected} (it is ${env.GOOGLE_REDIRECT_URI})`);
  google = {
    clientId: env.GOOGLE_CLIENT_ID!,
    clientSecret: env.GOOGLE_CLIENT_SECRET!,
    redirectUri: env.GOOGLE_REDIRECT_URI!,
    allowedEmails: env.ALLOWED_EMAILS!.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
    cookieSecret: env.COOKIE_SECRET!,
  };
} else if (publicUrl.startsWith("https://")) {
  // A public deployment without Google sign-in would leave the portal reachable only through a shared token.
  fail(`Google sign-in is required for ${publicUrl}: set ${googleKeys.join(", ")}`);
} else if (!adminToken) {
  fail("Local development needs ADMIN_TOKEN (at least 16 characters) when Google sign-in is not configured");
}

// One process owns the state database and the tables' sockets (D-071, D-114): a second replica would neither see the
// first one's sockets nor safely share its SQLite file. The replica count is in the cluster repository's manifest, far from this
// code, so the manifest passes it in and we warn loudly when it is wrong.
if (env.MAX_REPLICAS !== "1") {
  console.warn(`[cloud] WARNING: MAX_REPLICAS is ${env.MAX_REPLICAS ?? "unset"}; this service must run as exactly one replica`);
}
// DATA_DIR keeps the state across restarts (D-114): the PVC games-cloud-data at /data in the cluster. Unset = memory only.
if (!env.DATA_DIR) console.warn("[cloud] DATA_DIR is not set: pairings, access codes and logs are kept in memory and lost at restart");

/** "1" = loopback and the k3s pod/service networks; otherwise a comma-separated list of literal CIDRs. */
function parseTrustProxy(v: string | undefined): boolean | string[] {
  if (!v) return false;
  if (v === "1") return true;
  const list = v.split(",").map((c) => c.trim()).filter(Boolean);
  for (const c of list) {
    const [ip, bits, extra] = c.split("/");
    const max = isIP(ip) === 4 ? 32 : isIP(ip) === 6 ? 128 : 0;
    // A word like "loopback" is not a CIDR here: say so instead of crashing on it later.
    if (!max || extra !== undefined || !/^\d+$/.test(bits ?? "") || Number(bits) > max) fail(`TRUST_PROXY: "${c}" is not a CIDR like 10.42.0.0/16 (or set TRUST_PROXY=1)`);
  }
  return list;
}

// Extra-game repositories every start lists (D-098): deploy/game-repos.json, baked into the image, so the list survives
// restarts and changes by PR. GAME_REPOS (owner/name@ref, comma-separated) adds more, e.g. in local development;
// GAME_REPOS_FILE points elsewhere, and "none" turns the file off.
const repoFile = env.GAME_REPOS_FILE ?? fileURLToPath(new URL("../../../deploy/game-repos.json", import.meta.url));
let deployRepos: string[] = [];
if (repoFile !== "none") {
  let text: string | null = null;
  try {
    text = readFileSync(repoFile, "utf8");
  } catch {
    if (env.GAME_REPOS_FILE) fail(`GAME_REPOS_FILE ${repoFile} cannot be read`);
  }
  if (text !== null) {
    try {
      deployRepos = parseRepoConfig(text);
    } catch (e) {
      fail(`${repoFile}: ${(e as Error).message}`);
    }
  }
}

for (const k of ["LOG_STORAGE_MB", "DATA_LIMIT_MB"] as const) if (env[k] && !(Number(env[k]) >= 1)) fail(`${k} must be a number of megabytes, at least 1 (it is ${env[k]})`);

const cloud = await startCloud({
  port: Number(env.PORT ?? 8081),
  adminToken,
  google,
  publicUrl,
  logRetentionDays: Number(env.LOG_RETENTION_DAYS ?? 90),
  // e.g. [{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example:3478","username":"u","credential":"p"}]
  iceServers: env.ICE_SERVERS ? JSON.parse(env.ICE_SERVERS) : undefined,
  // "1": trust X-Forwarded-For from loopback and the k3s pod/service networks; or a comma-separated CIDR list.
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  gameRepos: [...deployRepos, ...(env.GAME_REPOS ?? "").split(",").map((x) => x.trim()).filter(Boolean)],
  // A fine-grained token with Contents: read on the private repositories (public ones need none).
  gameRepoToken: env.GAME_REPO_TOKEN || undefined,
  // GitHub's REST API; only the browser checks change it (scripts/e2e/extra.py serves a fake GitHub).
  githubApiUrl: env.GAME_REPO_API_URL || undefined,
  dataDir: env.DATA_DIR || undefined,
  // Cap on stored game logs, in MB (default 256); the volume's free space limits them too (D-114).
  maxLogBytes: env.LOG_STORAGE_MB ? Number(env.LOG_STORAGE_MB) * 1024 * 1024 : undefined,
  // The service's whole budget in DATA_DIR, in MB (default 1024, the PVC's size): a local-path PVC has no quota itself.
  dataLimitBytes: env.DATA_LIMIT_MB ? Number(env.DATA_LIMIT_MB) * 1024 * 1024 : undefined,
  // The PREVIEW / DRAFT sash on the public website (D-177): on until the launch sets PREVIEW_BANNER=0.
  previewBanner: env.PREVIEW_BANNER !== "0",
});
console.log(`[cloud] ${env.APP_VERSION || "dev"} listening on ${cloud.port}; admin sign-in: ${google ? `Google (${google.allowedEmails.length} allowed)` : "ADMIN_TOKEN only (development)"}`);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, async () => (await cloud.close(), process.exit(0)));
