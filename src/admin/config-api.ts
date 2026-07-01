// The Config area's typed-route logic (operator-admin), kept out of app.tsx so the route chain
// there stays thin. Each function calls the same src/ backend the Elm panel's endpoints used,
// returning the operation's data (or throwing a structured ToolError the app's onError maps).
// The Calibration island calls these via hc; the SSR Calibration page seeds from getDiscoveryConfig.

import type { Env } from "../env.js";
import {
  loadDiscoveryConfig,
  saveDiscoveryConfig,
  validateDiscoveryConfig,
  analyzeThresholds,
  buildDryRunDeps,
  type AnalyzeResult,
  type DryRunOutcome,
} from "../discovery-calibration.js";
import { buildDiscoveryDeps, runDiscoverySweep, type DiscoveryConfig } from "../discovery-sweep.js";
import { probeFeed, type FeedProbeResult } from "../discovery-probe.js";
import {
  loadOperatorConfig,
  saveOperatorConfig,
  validateOperatorConfig,
  parseOperatorConfigPatch,
  type OperatorConfig,
} from "../operator-config.js";
import { isCorpusTable, listCorpusTable, addCorpusRow, deleteCorpusRow } from "../admin-corpus.js";
import { ToolError } from "../errors.js";

/** The nine operator-editable discovery knobs (the read-only retry/feed defaults are never PUT). */
const DISCOVERY_FIELDS = [
  "tasteThreshold",
  "triageThreshold",
  "dedupThreshold",
  "classifyMaxPerTick",
  "rateCap",
  "fetchMaxPerTick",
  "maxCandidatesPerTick",
  "retryMaxAttempts",
  "logRetentionDays",
] as const;

/** Extract the present, numeric discovery knobs from a request body (mirrors src/admin.ts). */
function parseDiscoveryPatch(body: Record<string, unknown>): Partial<DiscoveryConfig> {
  const patch: Record<string, number> = {};
  for (const f of DISCOVERY_FIELDS) {
    if (typeof body[f] === "number") patch[f] = body[f] as number;
  }
  return patch as Partial<DiscoveryConfig>;
}

function preview(config: DiscoveryConfig, patch: Partial<DiscoveryConfig>): DiscoveryConfig {
  const present = Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null));
  return { ...config, ...present };
}

export async function getDiscoveryConfig(env: Env): Promise<{ config: DiscoveryConfig }> {
  return { config: await loadDiscoveryConfig(env) };
}

/** Write the operator overrides, enforcing the range + footgun-floor guards (floor breach →
 *  a structured `validation_failed` with `needsConfirm`, which the island re-submits with confirm). */
export async function putDiscoveryConfig(env: Env, body: Record<string, unknown>): Promise<{ config: DiscoveryConfig }> {
  const patch = parseDiscoveryPatch(body);
  const validation = validateDiscoveryConfig(patch, { confirm: body.confirm === true });
  if (validation.error) throw validation.error;
  await saveDiscoveryConfig(env, patch);
  return { config: await loadDiscoveryConfig(env) };
}

/** The cheap, no-AI δ/τ analysis at the given (previewed) knob values. */
export async function analyzeDiscovery(env: Env, body: Record<string, unknown>): Promise<AnalyzeResult> {
  const config = await loadDiscoveryConfig(env);
  return analyzeThresholds(env, preview(config, parseDiscoveryPatch(body)));
}

/** The no-write full-pipeline preview at the given knob values. */
export async function dryRunDiscovery(env: Env, body: Record<string, unknown>): Promise<{ outcomes: DryRunOutcome[] }> {
  const config = await loadDiscoveryConfig(env);
  const previewConfig = preview(config, parseDiscoveryPatch(body));
  const { deps, capturedOutcomes } = buildDryRunDeps(buildDiscoveryDeps(env));
  await runDiscoverySweep(deps, previewConfig);
  return { outcomes: capturedOutcomes() };
}

/** Edge feed-probe: fetch a feed + a sample of its entry pages from the Worker's egress. Read-only. */
export async function testFeed(env: Env, body: Record<string, unknown>): Promise<FeedProbeResult> {
  void env;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) throw new ToolError("validation_failed", "A feed url is required", { field: "url" });
  return probeFeed(url);
}

// --- Ranking + Flyer (operator config) ---------------------------------------

export async function getOperatorConfig(env: Env): Promise<{ config: OperatorConfig }> {
  return { config: await loadOperatorConfig(env) };
}

/** Write the operator ranking/flyer overrides, range- and floor-validated (the two flyer
 *  cadence knobs gate on `confirm`, mirroring putDiscoveryConfig's confirm handling). */
export async function putOperatorConfig(env: Env, body: Record<string, unknown>): Promise<{ config: OperatorConfig }> {
  const patch = parseOperatorConfigPatch(body);
  const err = validateOperatorConfig(patch as Record<string, unknown>, { confirm: body.confirm === true });
  if (err) throw err;
  await saveOperatorConfig(env, patch);
  return { config: await loadOperatorConfig(env) };
}

// --- Shared-corpus editors (aliases / flyer-terms / feeds / senders / members) ----------------

/** Validate the `<table>` slug (404 on unknown), narrowing it to the corpus-table union. */
function corpusTable(table: string): "aliases" | "flyer-terms" | "feeds" | "senders" | "members" {
  if (!isCorpusTable(table)) throw new ToolError("not_found", `No corpus table ${table}`, { table });
  return table;
}

export async function listCorpus(env: Env, table: string): Promise<ReturnType<typeof listCorpusTable>> {
  return listCorpusTable(env, corpusTable(table));
}

export async function addCorpus(env: Env, table: string, body: Record<string, unknown>): Promise<ReturnType<typeof addCorpusRow>> {
  return addCorpusRow(env, corpusTable(table), body);
}

export async function deleteCorpus(env: Env, table: string, key: string): Promise<ReturnType<typeof deleteCorpusRow>> {
  return deleteCorpusRow(env, corpusTable(table), key);
}
