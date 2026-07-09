// The small-model NAMING step for archetype derivation (night-vibe-archetype-derivation
// capability). Two impure (env.AI) helpers, kept out of the pure engine (night-vibe-derive.ts):
//   * nameCluster — name a cluster of recipes into a craving-aligned night-vibe phrase.
//   * starterVibesFromTaste — the COLD-START fallback: derive a few starter vibes from the
//     member's authored `taste` text when there is too little history to cluster.
// Both use the same small classifier the descriptions/discovery pipeline uses (a quick-summary
// task, off the frontier hot path), and fail SOFT (return null / []) so a naming hiccup skips a
// candidate rather than breaking the derivation pass.

import type { Env } from "./env.js";
import { runAi, type AiTrigger } from "./ai.js";
import { slugify } from "./discovery.js";
import { WEATHER_BUCKETS, type WeatherCategory } from "./weather.js";

/** Same small model the description + discovery classifier use — a grounded quick-summary task. */
export const NAME_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

interface TextGenResponse {
  response?: string;
}

// The naming call also classifies the cluster's discrete weather BUCKET (weather-bucket-planning)
// in the SAME generation — no second model call. Reply shape: the vibe phrase on line 1, the
// bucket label on line 2 (one of the categories below, or "neutral" for bucketless).
const BUCKET_LABELS = [...WEATHER_BUCKETS, "neutral"] as const;

const CLUSTER_SYSTEM =
  `You name a group of related recipes as a single 'night vibe' — a short craving-aligned phrase a home cook would recognize as a kind of dinner they make (e.g. 'a simple weeknight Italian pasta', 'a bright, quick fish dish', 'a slow weekend braise'). Base it strictly on the recipes shown; do not invent a cuisine or mood they don't share.\n\n` +
  `Then classify the group's weather character into exactly one label: ${BUCKET_LABELS.join(" | ")}. Use "grill" for hot-weather/outdoor-cooking dishes, "cold-comfort" for cold-weather soups/stews/braises, "wet" for rainy-day comfort dishes that avoid outdoor cooking, and "neutral" when the group has no strong weather lean.\n\n` +
  `Reply with EXACTLY two lines: line 1 is the vibe phrase (3-8 words, no quotes, no trailing punctuation); line 2 is the weather label alone.`;

/**
 * Name one cluster into a night-vibe phrase + discrete weather bucket from its members'
 * descriptions, in a SINGLE generation call. Returns the phrase, the (unchanged) inferred
 * cadence, and `weather_affinity` (a one-element category array, or `undefined` when
 * bucketless/neutral) — or null on an empty/failed generation (fail soft — the caller skips this
 * candidate). At most a handful of descriptions are sent to keep the prompt small.
 */
export async function nameCluster(
  env: Env,
  input: { descriptions: string[]; cadence_days: number | null },
  trigger: AiTrigger = "cron",
): Promise<{ vibe: string; cadence_days: number | null; weather_affinity?: WeatherCategory[] } | null> {
  const sample = input.descriptions.slice(0, 6);
  if (sample.length === 0) return null;
  const user = `These recipes are all in one group a member cooks:\n${sample.map((d) => `- ${d}`).join("\n")}\n\nName the vibe, then classify its weather label.`;
  let res: TextGenResponse;
  try {
    res = await runAi<TextGenResponse>(
      env,
      { activity: "nightvibe-name", trigger, calls: 1 },
      NAME_MODEL,
      {
        messages: [
          { role: "system", content: CLUSTER_SYSTEM },
          { role: "user", content: user },
        ],
        max_tokens: 32,
        temperature: 0.3,
      },
    );
  } catch {
    return null; // fail soft — a naming hiccup skips one candidate, never the whole pass
  }
  const lines = (res?.response ?? "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const vibe = cleanPhrase(lines[0]);
  if (!vibe) return null;
  const bucket = parseBucketLabel(lines[1]);
  const out: { vibe: string; cadence_days: number | null; weather_affinity?: WeatherCategory[] } = {
    vibe,
    cadence_days: input.cadence_days,
  };
  if (bucket) out.weather_affinity = [bucket];
  return out;
}

/** Parse a bucket-classification line into a `WeatherCategory`, or null when the line is
 *  missing, "neutral", or any other unrecognized value (fail-soft → bucketless, never blocking). */
function parseBucketLabel(raw: string | undefined): WeatherCategory | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, "")
    .replace(/[.!?,;:]+$/, "");
  return (WEATHER_BUCKETS as readonly string[]).includes(cleaned) ? (cleaned as WeatherCategory) : null;
}

const STARTER_SYSTEM =
  "You read a home cook's taste notes and propose a few distinct 'night vibes' — short craving-aligned phrases naming kinds of dinner they'd want on a normal week (e.g. 'a cozy comforting soup', 'a simple weeknight pasta', 'a bright grain bowl'). Reply with ONE phrase per line, 3-6 phrases, each 3-8 words, no numbering, no quotes. Only propose vibes clearly grounded in the notes.";

/**
 * COLD-START: derive a few starter vibe phrases from a member's authored taste text, for a member
 * with too little cooking history to cluster. Returns `{ id, vibe }` candidates (no cadence — a
 * starter vibe has no observed interval yet). Empty on blank taste or a failed generation.
 */
export async function starterVibesFromTaste(
  env: Env,
  tasteText: string | null,
  trigger: AiTrigger = "cron",
): Promise<{ id: string; vibe: string }[]> {
  const text = (tasteText ?? "").trim();
  if (!text) return [];
  let res: TextGenResponse;
  try {
    res = await runAi<TextGenResponse>(
      env,
      { activity: "nightvibe-name", trigger, calls: 1 },
      NAME_MODEL,
      {
        messages: [
          { role: "system", content: STARTER_SYSTEM },
          { role: "user", content: `Taste notes:\n${text}\n\nPropose the vibes.` },
        ],
        max_tokens: 120,
        temperature: 0.4,
      },
    );
  } catch {
    return [];
  }
  const lines = (res?.response ?? "")
    .split("\n")
    .map((l) => cleanPhrase(l))
    .filter((v): v is string => !!v);
  const seen = new Set<string>();
  const out: { id: string; vibe: string }[] = [];
  for (const vibe of lines) {
    const id = slugify(vibe);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, vibe });
    if (out.length >= 6) break;
  }
  return out;
}

/** Trim a model line into a clean phrase: strip quotes, list markers, and trailing punctuation. */
function cleanPhrase(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    // Strip a real list marker only (requires a trailing separator), so a phrase-internal number
    // like "5-spice braise" survives instead of losing its "5-".
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/[.!?,;:]+$/, "") // trailing sentence punctuation the model sometimes adds
    .trim();
  const words = cleaned.split(/\s+/).length;
  return cleaned && words >= 2 && words <= 10 ? cleaned : null;
}
