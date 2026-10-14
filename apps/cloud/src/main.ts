// Cloud service entry point. Configuration comes from environment variables; in the cluster they come from the
// games-oauth Secret (see scripts/sync-secrets.sh) and the Deployment's env.
import { isIP } from "node:net";
import { startCloud } from "./server.ts";
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

// State lives in this one process (D-036): a second replica would not see the first one's tables. The replica count is
// in kube-setup's manifest, far from this code, so the manifest passes it in and we warn loudly when it is wrong.
if (env.MAX_REPLICAS !== "1") {
  console.warn(`[cloud] WARNING: MAX_REPLICAS is ${env.MAX_REPLICAS ?? "unset"}; this service must run as exactly one replica until its state moves to a shared store`);
}

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
  // Extra-game repositories (D-097): listed in the console from the start, e.g. "klaushofrichter/extra-games@main".
  // The console can add more; like everything else here they are in memory until the persistent store lands.
  gameRepos: (env.GAME_REPOS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  // A fine-grained token with Contents: read on the private repositories (public ones need none).
  gameRepoToken: env.GAME_REPO_TOKEN || undefined,
  // GitHub's REST API; only the browser checks change it (scripts/e2e/extra.py serves a fake GitHub).
  githubApiUrl: env.GAME_REPO_API_URL || undefined,
});
console.log(`[cloud] ${env.APP_VERSION || "dev"} listening on ${cloud.port}; admin sign-in: ${google ? `Google (${google.allowedEmails.length} allowed)` : "ADMIN_TOKEN only (development)"}`);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, async () => (await cloud.close(), process.exit(0)));
