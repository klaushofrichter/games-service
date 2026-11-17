#!/usr/bin/env node
// The dependency check of the test jobs: `npm audit` at high severity, with a short list of advisories that are
// let through for a while (scripts/npm-audit-allow.json). npm has no way to ignore one advisory, and a new advisory
// with no fixed version yet would otherwise stop every pull request and release in every repository until its
// author ships one. An entry names the advisory, says why it is let through, and ends on a date: after that it
// blocks again, so nobody has to remember to take it out.
//
//   node scripts/npm-audit.mjs                       in games-service
//   node .games-service/scripts/npm-audit.mjs        in a game repository (it audits the directory it is run in)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LEVELS = ["info", "low", "moderate", "high", "critical"];
const BLOCK_FROM = LEVELS.indexOf("high");
const allow = JSON.parse(readFileSync(join(import.meta.dirname, "npm-audit-allow.json"), "utf8"));
const today = new Date().toISOString().slice(0, 10);

let report;
try {
  report = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  report = err.stdout; // npm audit exits 1 when it finds something; the report is still there
}
let audit;
try {
  audit = JSON.parse(report);
} catch {
  console.error("npm audit gave no report (no network, or no lockfile?)");
  process.exit(2);
}
if (audit.error) {
  console.error(`npm audit failed: ${audit.error.summary ?? JSON.stringify(audit.error)}`);
  process.exit(2);
}

// Every advisory behind the findings, once: a package is listed for its own advisories (objects in `via`) and for
// the vulnerable packages it depends on (names in `via`), which lead to the same advisories.
const advisories = new Map();
for (const v of Object.values(audit.vulnerabilities ?? {})) {
  for (const via of v.via ?? []) {
    if (typeof via !== "object" || !via.url) continue;
    const id = via.url.split("/").pop();
    if (!advisories.has(id)) advisories.set(id, { id, pkg: via.name, severity: via.severity, title: via.title, url: via.url });
  }
}
const blocking = [];
for (const a of advisories.values()) {
  if (LEVELS.indexOf(a.severity) < BLOCK_FROM) continue;
  const entry = allow.find((e) => e.id === a.id);
  if (entry && today <= entry.until) console.log(`let through until ${entry.until}: ${a.id} (${a.pkg}, ${a.severity}): ${entry.reason}`);
  else blocking.push({ ...a, expired: entry?.until });
}
for (const e of allow) if (!advisories.has(e.id)) console.log(`no longer found, take it off the list: ${e.id}`);
if (!blocking.length) {
  console.log("npm audit: nothing at high severity or above" + (advisories.size ? " that is not let through" : ""));
  process.exit(0);
}
for (const b of blocking) console.error(`${b.severity}: ${b.pkg}: ${b.title} (${b.url})${b.expired ? ` [was let through until ${b.expired}]` : ""}`);
console.error(`npm audit: ${blocking.length} ${blocking.length === 1 ? "advisory" : "advisories"} at high severity or above`);
process.exit(1);
