// A small tar.gz writer for tests: builds archives shaped like GitHub's tarball endpoint (a global pax header with
// the commit, then everything under "<owner>-<name>-<sha>/").
import { gzipSync } from "node:zlib";

function header(name: string, size: number, type: string): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148); // checksum placeholder
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}

const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);

/** files: path relative to the repository root → content. Paths longer than 100 bytes get a pax header. */
export function githubTarball(repo: string, sha: string, files: Record<string, string | Buffer>, extra: { name: string; type: string; data?: string }[] = []): Buffer {
  const top = `${repo.replace("/", "-")}-${sha}`;
  const parts: Buffer[] = [];
  const comment = Buffer.from(`52 comment=${sha.padEnd(40, "0")}\n`);
  parts.push(header("pax_global_header", comment.length, "g"), pad(comment));
  parts.push(header(`${top}/`, 0, "5"));
  for (const [path, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const name = `${top}/${path}`;
    if (Buffer.byteLength(name) > 100) {
      const rec = ` path=${name}\n`;
      let len = rec.length + 2;
      while (`${len}${rec}`.length !== len) len++;
      const pax = Buffer.from(`${len}${rec}`);
      parts.push(header("PaxHeader", pax.length, "x"), pad(pax));
    }
    parts.push(header(name, data.length, "0"), pad(data));
  }
  for (const e of extra) {
    const data = Buffer.from(e.data ?? "");
    parts.push(header(`${top}/${e.name}`, data.length, e.type), pad(data));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}
