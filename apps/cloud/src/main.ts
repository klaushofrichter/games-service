// Cloud service entry point. Configuration comes from environment variables; in the cluster they come from the
// games-oauth Secret (see scripts/sync-secrets.sh) and the Deployment's env.
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

const cloud = await startCloud({
  port: Number(env.PORT ?? 8081),
  adminToken,
  google,
  publicUrl,
  logRetentionDays: Number(env.LOG_RETENTION_DAYS ?? 90),
  // e.g. [{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example:3478","username":"u","credential":"p"}]
  iceServers: env.ICE_SERVERS ? JSON.parse(env.ICE_SERVERS) : undefined,
  // "1": trust X-Forwarded-For from loopback and the k3s pod/service networks; or a comma-separated CIDR list.
  trustProxy: env.TRUST_PROXY === "1" ? true : env.TRUST_PROXY ? env.TRUST_PROXY.split(",").map((c) => c.trim()) : false,
});
console.log(`[cloud] ${env.APP_VERSION || "dev"} listening on ${cloud.port}; admin sign-in: ${google ? `Google (${google.allowedEmails.length} allowed)` : "ADMIN_TOKEN only (development)"}`);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, async () => (await cloud.close(), process.exit(0)));
