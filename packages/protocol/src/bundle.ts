// Game bundles (D-097): the games of one extra-games repository, packed by the cloud service and unpacked by tables.
// A bundle is gzipped JSON with every file of the repo's games/ folder, base64-encoded. Its hash is the SHA-256 of the
// uncompressed JSON, which the cloud computes once and the table checks after download, so a table installs exactly
// the bytes the console showed. Node only (zlib, crypto): never imported by board or deck pages.
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

export const BUNDLE_FORMAT = "gametable-bundle/1";

/** Limits for one bundle: generous for board games, small enough to hold in memory on the service. */
export const BUNDLE_LIMITS = { files: 500, fileBytes: 5 * 1024 * 1024, totalBytes: 20 * 1024 * 1024, depth: 6 };

/** Every game a bundle offers, as the console and the table list them. */
export interface BundleGame {
  id: string;
  name: string;
  version: string;
}

export interface BundleContents {
  format: typeof BUNDLE_FORMAT;
  /** owner/name of the repository, and the branch or tag it came from. */
  repo: string;
  ref: string;
  /** The commit, as far as the source tells (GitHub tarballs name their top folder after it). */
  commit: string;
  games: BundleGame[];
  /** Relative paths under the bundle root ("games/<id>/rules.ts") → bytes. */
  files: Record<string, Buffer>;
}

/**
 * A relative path that is safe to write under a bundle root: plain segments only (letters, digits, dot, dash,
 * underscore), no "." or "..", no leading dot (no hidden files), not too deep. Anything else is refused, never
 * cleaned up, so a bundle can't place a file outside its own folder.
 */
export function safeBundlePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0 || p.length > 200) return false;
  const parts = p.split("/");
  if (parts.length > BUNDLE_LIMITS.depth) return false;
  return parts.every((s) => /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/.test(s) && s !== "." && s !== "..");
}

/** The JSON form, with keys in a fixed order so the same files always give the same hash. */
function canonical(b: BundleContents): string {
  const files: Record<string, string> = {};
  for (const p of Object.keys(b.files).sort()) files[p] = b.files[p].toString("base64");
  return JSON.stringify({ format: b.format, repo: b.repo, ref: b.ref, commit: b.commit, games: b.games, files });
}

export function encodeBundle(b: BundleContents): { hash: string; payload: Buffer } {
  const json = canonical(b);
  return { hash: createHash("sha256").update(json).digest("hex"), payload: gzipSync(json) };
}

/** Unpack and check a downloaded bundle: the hash must match and every path must be safe. Throws otherwise. */
export function decodeBundle(payload: Buffer, expectedHash: string): BundleContents {
  const raw = gunzipSync(payload, { maxOutputLength: BUNDLE_LIMITS.totalBytes * 2 });
  const hash = createHash("sha256").update(raw).digest("hex");
  if (hash !== expectedHash) throw new Error(`bundle hash mismatch (expected ${expectedHash.slice(0, 12)}, got ${hash.slice(0, 12)})`);
  const j = JSON.parse(raw.toString("utf8"));
  if (j.format !== BUNDLE_FORMAT) throw new Error(`unknown bundle format ${String(j.format)}`);
  const files: Record<string, Buffer> = {};
  const names = Object.keys(j.files ?? {});
  if (names.length > BUNDLE_LIMITS.files) throw new Error("too many files in bundle");
  for (const p of names) {
    if (!safeBundlePath(p) || !p.startsWith("games/")) throw new Error(`unsafe path in bundle: ${p}`);
    files[p] = Buffer.from(String(j.files[p]), "base64");
  }
  return { format: BUNDLE_FORMAT, repo: String(j.repo), ref: String(j.ref), commit: String(j.commit ?? ""), games: Array.isArray(j.games) ? j.games : [], files };
}

/**
 * Read a .tar.gz (as GitHub's tarball endpoint serves it). Regular files only; pax and GNU long names are honoured,
 * everything else (links, devices) is skipped. Returns path → bytes, paths exactly as the archive names them.
 */
export function readTarGz(gz: Buffer, maxBytes = BUNDLE_LIMITS.totalBytes * 4): Map<string, Buffer> {
  const tar = gunzipSync(gz, { maxOutputLength: maxBytes });
  const out = new Map<string, Buffer>();
  const str = (b: Buffer, from: number, len: number) => {
    const s = b.subarray(from, from + len);
    const end = s.indexOf(0);
    return s.subarray(0, end < 0 ? len : end).toString("utf8");
  };
  const octal = (b: Buffer, from: number, len: number) => parseInt(str(b, from, len).trim() || "0", 8);
  let pos = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  while (pos + 512 <= tar.length) {
    const h = tar.subarray(pos, pos + 512);
    if (h.every((x) => x === 0)) break; // end of archive
    const size = octal(h, 124, 12);
    const type = String.fromCharCode(h[156] || 48); // NUL is a regular file in old archives
    const prefix = str(h, 345, 155);
    const name = longName ?? paxPath ?? (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
    const dataStart = pos + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    if (data.length < size) throw new Error("truncated tar archive");
    pos = dataStart + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = data.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    if (type === "x") {
      // pax extended header: "<len> key=value\n" records; only path matters here.
      for (const rec of data.toString("utf8").split("\n")) {
        const m = rec.match(/^\d+ path=(.*)$/);
        if (m) paxPath = m[1];
      }
      continue;
    }
    if (type === "g") continue; // global pax header (GitHub puts the commit id here)
    longName = null;
    paxPath = null;
    if (type === "0" || type === "7") out.set(name, Buffer.from(data));
  }
  return out;
}
