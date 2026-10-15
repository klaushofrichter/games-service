// Extra-game repositories (D-097): the console keeps a list of GitHub repositories, each with a games/ folder in the
// same shape as this repo's. The service fetches a repository's games as one bundle; tables get the bundles of the
// repositories an admin ticked for them. Private repositories are read with GAME_REPO_TOKEN (read-only contents).
import { manifestSchema } from "../../../packages/protocol/src/index.ts";
import { BUNDLE_FORMAT, BUNDLE_LIMITS, encodeBundle, readTarGz, safeBundlePath, type BundleGame } from "../../../packages/protocol/src/bundle.ts";

export interface GameRepoOptions {
  /** Read token for private repositories (a fine-grained token with Contents: read on them). */
  token?: string;
  /** GitHub's REST API; tests point this at a fake. */
  apiUrl?: string;
}

export interface GameRepo {
  /** Short id used in the console and in table assignments: the repository name, made unique. */
  id: string;
  /** "deploy": from deploy/game-repos.json (or GAME_REPOS), back after every restart and not removable in the console.
   *  "console": added in the console; kept across restarts when the service has a DATA_DIR (D-113). */
  origin: "deploy" | "console";
  /** owner/name on GitHub. */
  repo: string;
  /** Branch or tag to fetch. */
  ref: string;
  addedAt: number;
  /** The last bundle that fetched and checked out cleanly. A failed refresh keeps it. */
  bundle: { hash: string; payload: Buffer; games: BundleGame[]; commit: string; bytes: number; fetchedAt: number } | null;
  /** Why the last fetch failed, or null. */
  error: string | null;
  lastAttempt: number | null;
}

const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9._/-]{1,100}$/;

/** "owner/name" or "owner/name@ref", as the console and GAME_REPOS take them. */
export function parseRepoSpec(spec: string): { repo: string; ref: string } {
  const [repo, ref = "main"] = spec.trim().split("@");
  if (!REPO_RE.test(repo) || repo.includes("..")) throw new Error(`"${spec}" is not a GitHub repository like owner/name or owner/name@branch`);
  if (!REF_RE.test(ref) || ref.includes("..")) throw new Error(`"${ref}" is not a branch or tag name`);
  return { repo, ref };
}

/** Fetch a repository's games/ folder and pack it. Throws with a message fit for the console. */
export async function fetchRepoBundle(repo: string, ref: string, o: GameRepoOptions) {
  const api = (o.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const r = await fetch(`${api}/repos/${repo}/tarball/${encodeURIComponent(ref)}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "games-service",
      "x-github-api-version": "2022-11-28",
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (r.status === 404) throw new Error(o.token ? `GitHub says ${repo}@${ref} does not exist, or GAME_REPO_TOKEN cannot read it` : `GitHub says ${repo}@${ref} does not exist (a private repository needs GAME_REPO_TOKEN)`);
  if (r.status === 401 || r.status === 403) throw new Error(`GitHub refused access to ${repo} (${r.status}); check GAME_REPO_TOKEN`);
  if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${repo}@${ref}`);
  // The whole repository comes down, not only games/: cap it so a huge repository can't fill the pod's memory.
  const MAX = 100 * 1024 * 1024;
  if (Number(r.headers.get("content-length") ?? 0) > MAX) throw new Error(`${repo} is larger than 100 MB as a tarball`);
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of r.body ?? []) {
    n += (c as Uint8Array).length;
    if (n > MAX) throw new Error(`${repo} is larger than 100 MB as a tarball`);
    chunks.push(Buffer.from(c as Uint8Array));
  }
  const gz = Buffer.concat(chunks);
  return packRepoTarball(gz, repo, ref);
}

/** Turn a GitHub tarball into a bundle: only games/**, every path checked, every manifest valid. */
export function packRepoTarball(gz: Buffer, repo: string, ref: string) {
  const entries = readTarGz(gz);
  const files: Record<string, Buffer> = {};
  let top = "";
  let total = 0;
  for (const [path, data] of entries) {
    // GitHub wraps everything in one folder, "<owner>-<name>-<short sha>/".
    const slash = path.indexOf("/");
    if (slash < 0) continue;
    top ||= path.slice(0, slash);
    const rel = path.slice(slash + 1);
    if (!rel.startsWith("games/")) continue;
    if (!safeBundlePath(rel)) throw new Error(`unsafe file name in ${repo}: ${rel}`);
    if (data.length > BUNDLE_LIMITS.fileBytes) throw new Error(`${rel} is larger than ${BUNDLE_LIMITS.fileBytes / 1024 / 1024} MB`);
    total += data.length;
    if (total > BUNDLE_LIMITS.totalBytes) throw new Error(`the games in ${repo} are larger than ${BUNDLE_LIMITS.totalBytes / 1024 / 1024} MB`);
    files[rel] = data;
  }
  if (Object.keys(files).length > BUNDLE_LIMITS.files) throw new Error(`${repo} has more than ${BUNDLE_LIMITS.files} game files`);
  const ids = [...new Set(Object.keys(files).map((p) => p.split("/")[1]))].sort();
  const games: BundleGame[] = [];
  for (const id of ids) {
    const raw = files[`games/${id}/manifest.json`];
    if (!raw) throw new Error(`games/${id} in ${repo} has no manifest.json`);
    let m;
    try {
      m = manifestSchema.parse(JSON.parse(raw.toString("utf8")));
    } catch (e) {
      throw new Error(`games/${id}/manifest.json in ${repo} is not valid: ${(e as Error).message.slice(0, 300)}`);
    }
    if (m.id !== id) throw new Error(`games/${id} in ${repo}: the manifest id "${m.id}" must match the folder name`);
    if (!files[`games/${id}/rules.ts`] && !files[`games/${id}/rules.js`]) throw new Error(`games/${id} in ${repo} has no rules.ts or rules.js`);
    games.push({ id: m.id, name: m.name, version: m.version });
  }
  if (!games.length) throw new Error(`${repo}@${ref} has no games/ folder with games in it`);
  const commit = top.split("-").at(-1) ?? "";
  const { hash, payload } = encodeBundle({ format: BUNDLE_FORMAT, repo, ref, commit, games, files });
  return { hash, payload, games, commit, bytes: payload.length };
}

/**
 * The deploy-time list (D-098): `{ "repos": [{ "repo": "owner/name", "ref": "branch" }] }`, as deploy/game-repos.json
 * holds it. Returns "owner/name@ref" specs; throws on anything malformed, so a broken file stops the service at start
 * (and the deploy's smoke test) instead of silently starting with fewer repositories.
 */
export function parseRepoConfig(text: string): string[] {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new Error(`not JSON: ${(e as Error).message}`);
  }
  const list = (j as { repos?: unknown })?.repos;
  if (!Array.isArray(list)) throw new Error('expected { "repos": [ { "repo": "owner/name", "ref": "branch" } ] }');
  return list.map((x, i) => {
    const e = x as { repo?: unknown; ref?: unknown };
    if (typeof e?.repo !== "string" || (e.ref !== undefined && typeof e.ref !== "string")) throw new Error(`repos[${i}] needs "repo" (and optionally "ref") as strings`);
    const spec = e.ref ? `${e.repo}@${e.ref}` : e.repo;
    parseRepoSpec(spec); // throws with a readable message
    return spec;
  });
}

/** The console's list of repositories. Console-added ones are saved by the server's store (D-113); bundles are fetched again at start. */
export class GameRepoStore {
  readonly repos = new Map<string, GameRepo>();
  private readonly o: GameRepoOptions;
  private inflight = new Map<string, Promise<GameRepo>>();

  constructor(o: GameRepoOptions) {
    this.o = o;
  }

  /** `keep` restores a repository from the persistent store with the id and date it had (D-113). */
  add(spec: string, origin: GameRepo["origin"] = "console", keep?: { id: string; addedAt: number }): GameRepo {
    const { repo, ref } = parseRepoSpec(spec);
    for (const r of this.repos.values()) if (r.repo.toLowerCase() === repo.toLowerCase() && r.ref === ref) throw Object.assign(new Error(`${repo}@${ref} is already in the list`), { status: 409 });
    if (this.repos.size >= 50) throw Object.assign(new Error("at most 50 repositories"), { status: 409 });
    const base = repo.split("/")[1].toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40) || "repo";
    let id = keep && /^[a-z0-9-]{1,48}$/.test(keep.id) && !this.repos.has(keep.id) ? keep.id : base;
    for (let n = 2; this.repos.has(id); n++) id = `${base}-${n}`;
    const r: GameRepo = { id, repo, ref, origin, addedAt: keep?.addedAt ?? Date.now(), bundle: null, error: null, lastAttempt: null };
    this.repos.set(id, r);
    return r;
  }

  /** Remove a repository added in the console. Deploy-time ones are refused: the next restart would bring them back. */
  remove(id: string) {
    const r = this.repos.get(id);
    if (!r) return false;
    if (r.origin === "deploy") throw Object.assign(new Error(`${r.repo}@${r.ref} is in the deploy configuration (deploy/game-repos.json); remove it there`), { status: 409 });
    return this.repos.delete(id);
  }

  /** Fetch one repository again. Concurrent refreshes of the same repository share one fetch. */
  refresh(id: string): Promise<GameRepo> {
    const r = this.repos.get(id);
    if (!r) return Promise.reject(Object.assign(new Error("no such repository"), { status: 404 }));
    const running = this.inflight.get(id);
    if (running) return running;
    const p = (async () => {
      r.lastAttempt = Date.now();
      try {
        const b = await fetchRepoBundle(r.repo, r.ref, this.o);
        r.bundle = { ...b, fetchedAt: Date.now() };
        r.error = null;
      } catch (e) {
        r.error = (e as Error).message;
        console.warn(`[cloud] game repository ${r.repo}@${r.ref}: ${r.error}`);
      }
      return r;
    })().finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  refreshAll() {
    return Promise.all([...this.repos.keys()].map((id) => this.refresh(id)));
  }

  /** For the console: everything but the bundle bytes. Game ids that more than one repository offers are flagged. */
  list() {
    const owners = new Map<string, string[]>();
    for (const r of this.repos.values()) for (const g of r.bundle?.games ?? []) owners.set(g.id, [...(owners.get(g.id) ?? []), r.id]);
    return [...this.repos.values()].map((r) => ({
      id: r.id,
      repo: r.repo,
      ref: r.ref,
      origin: r.origin,
      addedAt: r.addedAt,
      error: r.error,
      lastAttempt: r.lastAttempt,
      bundle: r.bundle ? { hash: r.bundle.hash, games: r.bundle.games, commit: r.bundle.commit, bytes: r.bundle.bytes, fetchedAt: r.bundle.fetchedAt } : null,
      clashes: (r.bundle?.games ?? []).filter((g) => (owners.get(g.id)?.length ?? 0) > 1).map((g) => g.id),
    }));
  }

  /** What a table with these repositories should have installed: one entry per repository with a bundle. */
  forTable(ids: string[]) {
    return ids
      .map((id) => this.repos.get(id))
      .filter((r): r is GameRepo & { bundle: NonNullable<GameRepo["bundle"]> } => !!r?.bundle)
      .map((r) => ({ repo: r.id, source: `${r.repo}@${r.ref}`, hash: r.bundle.hash, commit: r.bundle.commit, games: r.bundle.games, bytes: r.bundle.bytes }));
  }

  /** The bundle bytes for a hash, if one of these repositories currently has it. */
  payloadFor(ids: string[], hash: string): Buffer | null {
    for (const id of ids) {
      const r = this.repos.get(id);
      if (r?.bundle?.hash === hash) return r.bundle.payload;
    }
    return null;
  }
}
