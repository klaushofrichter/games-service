#!/usr/bin/env node
// The website's links to other websites (D-312): does each still lead somewhere? Run by hand, or when a link looks
// dead: `node scripts/check-site-links.mjs [https://games.skylar.technology]`. The links within the website are
// checked with every change (tests/website.test.ts, scripts/e2e/website.py); these depend on other people's servers
// and the network, so they are not part of the checks a change must pass.
//
// Fails (exit 1) on a link that is gone (404, 410), a server error or a host that does not answer. A page that only
// refuses a program (401, 403, 429: sign-in walls, rate limits) is listed as not checked.
const base = (process.argv[2] ?? "https://games.skylar.technology").replace(/\/$/, "");
const pages = ["/", "/build", "/faq", "/terms"];
const found = new Map(); // url -> the pages that link to it
for (const path of pages) {
  const r = await fetch(base + path);
  if (!r.ok) {
    console.error(`${base}${path} answers ${r.status}`);
    process.exit(1);
  }
  const html = await r.text();
  for (const [, href] of html.matchAll(/<a\b[^>]*\shref="(https?:\/\/[^"]+)"/g)) {
    const url = href.replaceAll("&amp;", "&");
    if (!url.startsWith(base) && !url.includes("${")) found.set(url, [...(found.get(url) ?? []), path]); // (not a link the script writes)
  }
}
const ask = async (url, method) => {
  const r = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "user-agent": "link-check" } });
  await r.body?.cancel();
  return r.status;
};
let gone = 0, unchecked = 0;
for (const [url, from] of [...found].sort()) {
  let status;
  try {
    status = await ask(url, "HEAD");
    if (status === 405 || status === 501) status = await ask(url, "GET");
  } catch (err) {
    status = `no answer (${err.cause?.code ?? err.name})`;
  }
  const where = `(on ${[...new Set(from)].join(", ")})`;
  if (typeof status === "number" && status < 400) console.log(`ok   ${status}  ${url}`);
  else if ([401, 403, 429].includes(status)) (unchecked++, console.log(`?    ${status}  ${url}  not checked: it refuses a program ${where}`));
  else (gone++, console.log(`DEAD ${status}  ${url} ${where}`));
}
console.log(`\n${found.size} links to other websites: ${found.size - gone - unchecked} answer, ${unchecked} not checked, ${gone} dead`);
process.exit(gone ? 1 : 0);
