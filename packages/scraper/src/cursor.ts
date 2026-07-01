// The already-pushed cursor: a bounded set of canonical recipe URLs the machine has
// already pushed, persisted to <configDir>/state/seen.json. It is a pure OPTIMIZATION —
// the Worker dedups authoritatively on arrival, so a lost/reset cursor only means some
// URLs get re-pushed and deduped, never a correctness problem. That's why it's a plain
// JSON set with a size cap (oldest-evicted) rather than anything durable.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Default cap on remembered URLs — large enough for many sources, bounded so the file can't grow forever. */
const DEFAULT_MAX = 50_000;

/** Strip query + fragment + trailing slash so tracker-wrapped and bare links compare equal
 *  (mirrors the Worker's canonicalizeUrl, kept local so the scraper has no Worker import). */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return raw.trim();
  }
}

/** Absolute path to the cursor file on the volume. */
export function cursorPath(configDir: string): string {
  return join(configDir, "state", "seen.json");
}

/**
 * A bounded insertion-ordered set of pushed URLs. Insertion order (a Set preserves it) is
 * the eviction order: when full, the oldest entry is dropped. All URLs are canonicalized
 * on the way in/queried, so callers can pass raw links.
 */
export class Cursor {
  private readonly seen: Set<string>;

  constructor(
    private readonly configDir: string,
    initial: string[] = [],
    private readonly max: number = DEFAULT_MAX,
  ) {
    this.seen = new Set(initial.map(canonicalizeUrl));
  }

  /** True when this (canonicalized) URL has already been pushed. */
  has(url: string): boolean {
    return this.seen.has(canonicalizeUrl(url));
  }

  /** Record a URL as pushed, evicting the oldest entry when over the cap. */
  add(url: string): void {
    const key = canonicalizeUrl(url);
    // Re-insert to move an existing key to the newest position (LRU-ish freshness).
    this.seen.delete(key);
    this.seen.add(key);
    while (this.seen.size > this.max) {
      const oldest = this.seen.values().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }

  /** Number of remembered URLs. */
  get size(): number {
    return this.seen.size;
  }

  /** The remembered URLs, oldest-first. */
  urls(): string[] {
    return [...this.seen];
  }

  /** Load a cursor from the volume; a missing/corrupt file yields an empty cursor (harmless). */
  static load(configDir: string, max: number = DEFAULT_MAX): Cursor {
    const path = cursorPath(configDir);
    if (!existsSync(path)) return new Cursor(configDir, [], max);
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { urls?: unknown };
      const urls = Array.isArray(parsed.urls) ? parsed.urls.filter((u): u is string => typeof u === "string") : [];
      return new Cursor(configDir, urls, max);
    } catch {
      return new Cursor(configDir, [], max);
    }
  }

  /** Persist the cursor to the volume (creating the state dir as needed). */
  save(): void {
    const path = cursorPath(this.configDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ urls: [...this.seen] }, null, 0), "utf8");
  }
}
