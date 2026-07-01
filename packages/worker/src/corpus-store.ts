// R2-backed authored-corpus store (r2-corpus-store). The single data-access path for
// the authored markdown corpus — `recipes/*.md` and `guidance/**/*.md` — replacing the
// former `GitHubClient` seam (src/github.ts). The rest of the Worker is agnostic to the
// backing store: it sees `getFile` / `listDir` / `put` / `delete` over markdown objects
// addressed by repo-relative path, exactly the surface the corpus used on GitHub. There
// is no GitHub App, installation token, or GitHub API call on this path.
//
// Structured errors, no throws (D4): an ABSENT object is `null` (getFile) or `[]`
// (listDir) — not an exception — so the common "not found" case is data, not a throw.
// A genuine R2 failure maps to `ToolError("upstream_unavailable")`, which the tool
// boundary serializes like any other structured error. A single-file write is one
// `R2.put`, atomic at the object level (the git commit engine's atomic MULTI-file batch
// has no R2 equivalent — see saveGuidance / design Decision 4).

import { ToolError } from "./errors.js";

/** One entry in a directory listing (mirrors the subset of the Contents API the corpus used). */
export interface DirEntry {
  name: string;
  type: "file" | "dir";
}

/**
 * The authored-corpus data interface. Read/list/write of markdown objects by path —
 * the seam every corpus reader/writer closes over, so swapping the backing store
 * (R2 today; a GitHub adapter is no longer on the path) touches only the wiring.
 */
export interface CorpusStore {
  /** Read an object's UTF-8 text; `null` when the object is absent (not an error). */
  getFile(path: string): Promise<string | null>;
  /** List the immediate children of a directory prefix; `[]` when the prefix has none. */
  listDir(path: string): Promise<DirEntry[]>;
  /**
   * Recursively list every object key under a prefix (no delimiter) — the whole-tree read
   * the reconcile needs to project the index over the entire `recipes/` corpus. `[]` when
   * the prefix has no objects.
   */
  list(prefix: string): Promise<string[]>;
  /** Write an object's full content (single-object atomic). */
  put(path: string, content: string): Promise<void>;
  /** Delete an object; a no-op when it is already absent. */
  delete(path: string): Promise<void>;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Build a `CorpusStore` over a bound R2 bucket. Object keys are the repo-relative paths
 * the corpus already used (`recipes/<slug>.md`, `guidance/<domain>/<slug>.md`), so the
 * migration is a key-for-key copy and the read/write call sites are unchanged but for
 * the seam type.
 */
export function createR2CorpusStore(bucket: R2Bucket): CorpusStore {
  async function getFile(path: string): Promise<string | null> {
    let obj: R2ObjectBody | null;
    try {
      obj = await bucket.get(path);
    } catch (e) {
      throw new ToolError("upstream_unavailable", `R2 get failed for ${path}: ${msg(e)}`, { path });
    }
    return obj ? obj.text() : null;
  }

  async function listDir(path: string): Promise<DirEntry[]> {
    // R2 list is prefix-based. A trailing-slash prefix + "/" delimiter yields the
    // IMMEDIATE children only — objects become files, delimitedPrefixes become dirs —
    // mirroring the one-level Contents-API listDir the corpus used. An empty prefix
    // lists the bucket root.
    const prefix = path === "" || path.endsWith("/") ? path : `${path}/`;
    const out: DirEntry[] = [];
    let cursor: string | undefined;
    try {
      for (;;) {
        const res = await bucket.list({ prefix, delimiter: "/", cursor });
        for (const o of res.objects) {
          const name = o.key.slice(prefix.length);
          if (name) out.push({ name, type: "file" });
        }
        for (const p of res.delimitedPrefixes) {
          const name = p.slice(prefix.length).replace(/\/$/, "");
          if (name) out.push({ name, type: "dir" });
        }
        if (!res.truncated) break;
        cursor = res.cursor;
      }
    } catch (e) {
      throw new ToolError("upstream_unavailable", `R2 list failed for ${prefix}: ${msg(e)}`, { path });
    }
    return out;
  }

  async function list(prefix: string): Promise<string[]> {
    // No delimiter → every object at any depth under the prefix (the whole-tree read).
    const keys: string[] = [];
    let cursor: string | undefined;
    try {
      for (;;) {
        const res = await bucket.list({ prefix, cursor });
        for (const o of res.objects) keys.push(o.key);
        if (!res.truncated) break;
        cursor = res.cursor;
      }
    } catch (e) {
      throw new ToolError("upstream_unavailable", `R2 list failed for ${prefix}: ${msg(e)}`, { prefix });
    }
    return keys;
  }

  async function put(path: string, content: string): Promise<void> {
    try {
      await bucket.put(path, content);
    } catch (e) {
      throw new ToolError("upstream_unavailable", `R2 put failed for ${path}: ${msg(e)}`, { path });
    }
  }

  async function del(path: string): Promise<void> {
    try {
      await bucket.delete(path);
    } catch (e) {
      throw new ToolError("upstream_unavailable", `R2 delete failed for ${path}: ${msg(e)}`, { path });
    }
  }

  return { getFile, listDir, list, put, delete: del };
}

/**
 * Read a corpus file, mapping an absent object to `ToolError(notFoundCode)` and a store
 * failure (already a ToolError from the store) straight through. The corpus counterpart
 * of the former gh-read `readFile`.
 */
export async function readCorpusFile(
  store: CorpusStore,
  path: string,
  notFoundCode: "not_found" | "index_unavailable",
  notFoundMessage: string,
): Promise<string> {
  const content = await store.getFile(path);
  if (content === null) throw new ToolError(notFoundCode, notFoundMessage);
  return content;
}
