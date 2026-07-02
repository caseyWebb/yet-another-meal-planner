// The push layer: build a v2 wire-contract SatelliteBatch and POST it to the Worker's
// /admin/api/ingest, self-validating with the shared strict schema before the network so a
// bad batch is caught locally, and mapping the endpoint's status/body to a coarse outcome.
//
// The endpoint returns { received, accepted, deduped, rejected, results } on 200; the
// push-level result (accepted vs. partial) is DERIVED from those counts, since the body
// doesn't carry it. Network errors, 5xx, and 429 are retried with exponential backoff (a
// re-push is safe — the Worker dedups on arrival). `fetchImpl` is injectable so tests use
// a fake with no network.

import {
  CONTRACT_VERSION,
  parseSatelliteBatch,
  type BatchResponse,
  type SatelliteBatch,
  type RecipeItem,
} from "@grocery-agent/contract";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Read this package's version from package.json (stamped onto every batch as satellite_version). */
function readSatelliteVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The machine's reported build version — resolved once at module load. */
export const SATELLITE_VERSION = readSatelliteVersion();

/**
 * Build a validated-shape v2 batch for one source under the `recipe-scrape` capability, tagging
 * each functional-facts item with its observation `kind`. Does not self-validate — pushBatch does.
 */
export function buildBatch(source: string, items: RecipeItem[]): SatelliteBatch {
  return {
    capability: "recipe-scrape",
    source,
    satellite_version: SATELLITE_VERSION,
    contract_version: CONTRACT_VERSION,
    observations: items.map((item) => ({ kind: "recipe" as const, ...item })),
  };
}

/** The coarse outcome of one push attempt sequence. */
export type PushOutcome =
  | { result: "accepted"; response: BatchResponse }
  | { result: "partial"; response: BatchResponse }
  | { result: "bad_key" }
  | { result: "bad_payload"; error: string }
  | { result: "rate_limited" }
  | { result: "error"; error: string };

/** The subset of the global fetch we depend on — makes the fake in tests trivial. */
export type FetchImpl = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

/** Retry/backoff knobs (small — this is a home daemon, not a fleet client). */
export interface PushOptions {
  maxAttempts?: number;
  /** Base backoff in ms; attempt N waits baseDelayMs * 2^(N-1). Injectable for fast tests. */
  baseDelayMs?: number;
  /** Sleep function (injectable so tests don't actually wait). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * POST a batch to <connectorUrl>/admin/api/ingest with the ingest key.
 *
 * - Self-validates with the strict SatelliteBatchSchema first → `bad_payload` locally, no network.
 * - 200 → accepted (clean) or partial (any deduped/rejected), carrying the response summary.
 * - 401 → bad_key (no retry — the key won't fix itself).
 * - 400 → bad_payload (no retry — the payload won't fix itself).
 * - 429 / 5xx / network error → retried with exponential backoff up to maxAttempts.
 */
export async function pushBatch(
  connectorUrl: string,
  key: string,
  batch: SatelliteBatch,
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
  options: PushOptions = {},
): Promise<PushOutcome> {
  const self = parseSatelliteBatch(batch);
  if (!self.ok) return { result: "bad_payload", error: self.error };

  const url = `${connectorUrl.replace(/\/+$/, "")}/admin/api/ingest`;
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;

  let lastError = "unknown error";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let status: number;
    let bodyReader: () => Promise<unknown>;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(batch),
      });
      status = res.status;
      bodyReader = res.json;
    } catch (err) {
      // Network failure — retry with backoff.
      lastError = (err as Error).message;
      if (attempt < maxAttempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
      continue;
    }

    if (status === 200) {
      const response = (await bodyReader().catch(() => null)) as BatchResponse | null;
      const summary: BatchResponse = response ?? {
        received: batch.observations.length,
        accepted: batch.observations.length,
        deduped: 0,
        rejected: 0,
        results: [],
      };
      const clean = summary.deduped === 0 && summary.rejected === 0;
      return { result: clean ? "accepted" : "partial", response: summary };
    }
    if (status === 401) return { result: "bad_key" };
    if (status === 400) {
      const body = (await bodyReader().catch(() => null)) as { message?: string } | null;
      return { result: "bad_payload", error: body?.message ?? "bad payload" };
    }
    // 429 or 5xx (or any other non-2xx) — back off and retry.
    lastError = `http ${status}`;
    if (attempt < maxAttempts) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    return status === 429 ? { result: "rate_limited" } : { result: "error", error: lastError };
  }
  return { result: "error", error: lastError };
}
