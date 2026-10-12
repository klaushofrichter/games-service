import { startCloud } from "./server.ts";

const adminToken = process.env.ADMIN_TOKEN;
if (!adminToken || adminToken.length < 16) {
  console.error("[cloud] ADMIN_TOKEN (at least 16 characters) is required");
  process.exit(1);
}

const cloud = await startCloud({
  port: Number(process.env.PORT ?? 8081),
  adminToken,
  publicUrl: process.env.PUBLIC_URL ?? "https://games.skylar.technology",
  logRetentionDays: Number(process.env.LOG_RETENTION_DAYS ?? 90),
  // e.g. [{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example:3478","username":"u","credential":"p"}]
  iceServers: process.env.ICE_SERVERS ? JSON.parse(process.env.ICE_SERVERS) : undefined,
  trustProxy: process.env.TRUST_PROXY === "1",
});
console.log(`[cloud] listening on ${cloud.port}`);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, async () => (await cloud.close(), process.exit(0)));
