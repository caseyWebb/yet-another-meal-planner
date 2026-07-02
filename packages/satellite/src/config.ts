// Config loading: the operator's satellite.toml (parsed by smol-toml) + the two pieces of
// runtime context that are NOT in the file — the ingest key (a secret, from the env) and
// the config/session directory (the mounted volume). We validate the parsed shape into a
// typed SatelliteConfig and throw a clear, actionable error on anything malformed, since a
// misconfigured machine should fail loud at startup rather than push garbage.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

/** One configured paid source on this machine. */
export interface SourceConfig {
  /** Stable id — names the session file, the cursor scope, and the batch `source`. */
  id: string;
  /** The adapter that handles this source: a built-in name (e.g. "jsonld") or an operator module. */
  adapter: string;
  /** Fetch mechanism. Defaults to plain HTTP; "browser" opts into the Playwright tier. */
  fetch_tier?: "http" | "browser";
  /** Discovery source for the generic adapter: a sitemap.xml URL… */
  sitemap_url?: string;
  /** …or an RSS/Atom feed URL. */
  feed_url?: string;
  /** Recurring "incremental" (unseen only) vs. a one-off "backfill" of the whole archive. */
  mode?: "incremental" | "backfill";
}

/** The whole machine's config. */
export interface SatelliteConfig {
  /** The grocery-mcp connector base URL; `/admin/api/ingest` is appended for the push. */
  connector_url: string;
  /** Optional mounted directory of operator-authored adapter modules. */
  adapters_dir?: string;
  /** Optional cron-ish schedule string for `run --watch` (interpreted by the scheduler/CLI). */
  schedule?: string;
  sources: SourceConfig[];
}

/** Runtime context resolved outside the TOML: the secret key + the mounted volume path. */
export interface RuntimeContext {
  config: SatelliteConfig;
  /** The single ingest key for this machine (from INGEST_API_KEY). */
  ingestKey: string;
  /** The mounted config/session/state volume (default /config). */
  configDir: string;
}

const KNOWN_TIERS = new Set(["http", "browser"]);
const KNOWN_MODES = new Set(["incremental", "backfill"]);

/** Assert a value is a non-empty string, throwing a field-scoped error otherwise. */
function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`satellite config: "${field}" must be a non-empty string`);
  }
  return value.trim();
}

/** Validate one raw `[[sources]]` table into a SourceConfig. */
function parseSource(raw: unknown, index: number): SourceConfig {
  if (raw === null || typeof raw !== "object") {
    throw new Error(`satellite config: sources[${index}] must be a table`);
  }
  const o = raw as Record<string, unknown>;
  const id = requireString(o.id, `sources[${index}].id`);
  const adapter = requireString(o.adapter, `sources[${index}].adapter`);

  const source: SourceConfig = { id, adapter };

  if (o.fetch_tier !== undefined) {
    if (typeof o.fetch_tier !== "string" || !KNOWN_TIERS.has(o.fetch_tier)) {
      throw new Error(`satellite config: sources[${index}].fetch_tier must be "http" or "browser"`);
    }
    source.fetch_tier = o.fetch_tier as SourceConfig["fetch_tier"];
  }
  if (o.mode !== undefined) {
    if (typeof o.mode !== "string" || !KNOWN_MODES.has(o.mode)) {
      throw new Error(`satellite config: sources[${index}].mode must be "incremental" or "backfill"`);
    }
    source.mode = o.mode as SourceConfig["mode"];
  }
  if (o.sitemap_url !== undefined) source.sitemap_url = requireString(o.sitemap_url, `sources[${index}].sitemap_url`);
  if (o.feed_url !== undefined) source.feed_url = requireString(o.feed_url, `sources[${index}].feed_url`);

  return source;
}

/** Validate a raw parsed TOML object into a SatelliteConfig, throwing on a bad shape. */
export function parseConfig(raw: unknown): SatelliteConfig {
  if (raw === null || typeof raw !== "object") {
    throw new Error("satellite config: top level must be a table");
  }
  const o = raw as Record<string, unknown>;
  const connector_url = requireString(o.connector_url, "connector_url");
  try {
    const u = new URL(connector_url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
  } catch {
    throw new Error(`satellite config: "connector_url" must be a valid http(s) URL (got ${connector_url})`);
  }

  if (!Array.isArray(o.sources) || o.sources.length === 0) {
    throw new Error('satellite config: at least one [[sources]] entry is required');
  }
  const sources = o.sources.map(parseSource);

  const ids = new Set<string>();
  for (const s of sources) {
    if (ids.has(s.id)) throw new Error(`satellite config: duplicate source id "${s.id}"`);
    ids.add(s.id);
  }

  const config: SatelliteConfig = { connector_url, sources };
  if (o.adapters_dir !== undefined) config.adapters_dir = requireString(o.adapters_dir, "adapters_dir");
  if (o.schedule !== undefined) config.schedule = requireString(o.schedule, "schedule");
  return config;
}

/** Parse a TOML string into a validated SatelliteConfig. */
export function parseConfigToml(toml: string): SatelliteConfig {
  let raw: unknown;
  try {
    raw = parseToml(toml);
  } catch (err) {
    throw new Error(`satellite config: TOML parse error: ${(err as Error).message}`);
  }
  return parseConfig(raw);
}

/**
 * Load the machine's full runtime context: read satellite.toml from the config dir, read the
 * ingest key from INGEST_API_KEY, and resolve the config dir (arg → SATELLITE_CONFIG_DIR env
 * → /config default). Throws a clear error when the file, key, or shape is missing/invalid.
 */
export function loadRuntimeContext(opts: { configDir?: string; configPath?: string } = {}): RuntimeContext {
  const configDir = opts.configDir ?? process.env.SATELLITE_CONFIG_DIR ?? "/config";
  const configPath = opts.configPath ?? join(configDir, "satellite.toml");

  let toml: string;
  try {
    toml = readFileSync(configPath, "utf8");
  } catch (err) {
    throw new Error(`satellite config: could not read ${configPath}: ${(err as Error).message}`);
  }
  const config = parseConfigToml(toml);

  const ingestKey = process.env.INGEST_API_KEY?.trim();
  if (!ingestKey) {
    throw new Error("satellite config: INGEST_API_KEY environment variable is required (the machine's ingest key)");
  }

  return { config, ingestKey, configDir };
}
