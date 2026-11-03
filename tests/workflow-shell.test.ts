// Every bash `run:` block of the workflows passes `bash -n`. A quote closed one line too early in the packages'
// publish step (D-269) failed only at the publish itself, after every package test had passed (D-271).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(import.meta.dirname, "..", ".github", "workflows");

/** The `run: |` blocks of a workflow file that bash runs (not pwsh/powershell/cmd), with GitHub expressions replaced. */
function bashBlocks(text: string): { line: number; script: string }[] {
  const lines = text.split("\n");
  const out: { line: number; script: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:- )?run: \|\s*$/);
    if (!m) continue;
    const indent = m[1].length;
    // The step's shell: look back to the step's start ("- " at a smaller indent) for "shell:".
    let shell = "bash";
    for (let j = i - 1; j >= 0; j--) {
      const s = lines[j].match(/^\s*shell:\s*(\S+)/);
      if (s) shell = s[1];
      if (/^\s*- /.test(lines[j]) && lines[j].search(/\S/) < indent) break;
    }
    const body: string[] = [];
    let k = i + 1;
    for (; k < lines.length; k++) {
      if (lines[k].trim() === "") { body.push(""); continue; }
      if (lines[k].search(/\S/) <= indent) break;
      body.push(lines[k]);
    }
    if (/pwsh|powershell|cmd/.test(shell)) continue;
    const pad = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
    out.push({ line: i + 1, script: body.map((l) => l.slice(pad)).join("\n").replace(/\$\{\{[^}]*\}\}/g, "X") });
  }
  return out;
}

describe("workflow shell scripts", () => {
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    it(`${f}: every bash run block parses`, () => {
      for (const b of bashBlocks(readFileSync(join(dir, f), "utf8"))) {
        let err = "";
        try {
          execFileSync("bash", ["-n"], { input: b.script, stdio: ["pipe", "pipe", "pipe"] });
        } catch (e) {
          err = String((e as { stderr?: Buffer }).stderr ?? e);
        }
        expect(err, `${f}:${b.line}`).toBe("");
      }
    });
  }
});
