// The small-model NAMING step for archetype derivation (night-vibe-archetype-derivation
// capability). Two impure (env.AI) helpers, kept out of the pure engine (night-vibe-derive.ts):
//   * nameCluster — name a cluster of recipes into a craving-aligned night-vibe phrase.
//   * starterVibesFromTaste — the COLD-START fallback: derive a few starter vibes from the
//     member's authored `taste` text when there is too little history to cluster.
// Both use the same small classifier the descriptions/discovery pipeline uses (a quick-summary
// task, off the frontier hot path), and fail SOFT (return null / []) so a naming hiccup skips a
// candidate rather than breaking the derivation pass.

import type { Env } from "./env.js";
import { slugify } from "./discovery.js";

/** Same small model the description + discovery classifier use — a grounded quick-summary task. */
export const NAME_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

interface TextGenResponse {
  response?: string;
}

const CLUSTER_SYSTEM =
  "You name a group of related recipes as a single 'night vibe' — a short craving-aligned phrase a home cook would recognize as a kind of dinner they make (e.g. 'a simple weeknight Italian pasta', 'a bright, quick fish dish', 'a slow weekend braise'). Reply with ONLY the phrase, 3-8 words, no quotes, no punctuation at the end. Base it strictly on the recipes shown; do not invent a cuisine or mood they don't share.";

/**
 * Name one cluster into a night-vibe phrase from its members' descriptions. Returns the phrase +
 * the (unchanged) inferred cadence, or null on an empty/failed generation (fail soft — the caller
 * skips this candidate). At most a handful of descriptions are sent to keep the prompt small.
 */
export async function nameCluster(
  env: Env,
  input: { descriptions: string[]; cadence_days: number | null },
): Promise<{ vibe: string; cadence_days: number | null } | null> {
  const sample = input.descriptions.slice(0, 6);
  if (sample.length === 0) return null;
  const user = `These recipes are all in one group a member cooks:\n${sample.map((d) => `- ${d}`).join("\n")}\n\nName the vibe.`;
  let res: TextGenResponse;
  try {
    res = (await env.AI.run(NAME_MODEL, {
      messages: [
        { role: "system", content: CLUSTER_SYSTEM },
        { role: "user", content: user },
      ],
      max_tokens: 24,
      temperature: 0.3,
    })) as unknown as TextGenResponse;
  } catch {
    return null; // fail soft — a naming hiccup skips one candidate, never the whole pass
  }
  const vibe = cleanPhrase(res?.response);
  return vibe ? { vibe, cadence_days: input.cadence_days } : null;
}

const STARTER_SYSTEM =
  "You read a home cook's taste notes and propose a few distinct 'night vibes' — short craving-aligned phrases naming kinds of dinner they'd want on a normal week (e.g. 'a cozy comforting soup', 'a simple weeknight pasta', 'a bright grain bowl'). Reply with ONE phrase per line, 3-6 phrases, each 3-8 words, no numbering, no quotes. Only propose vibes clearly grounded in the notes.";

/**
 * COLD-START: derive a few starter vibe phrases from a member's authored taste text, for a member
 * with too little cooking history to cluster. Returns `{ id, vibe }` candidates (no cadence — a
 * starter vibe has no observed interval yet). Empty on blank taste or a failed generation.
 */
export async function starterVibesFromTaste(env: Env, tasteText: string | null): Promise<{ id: string; vibe: string }[]> {
  const text = (tasteText ?? "").trim();
  if (!text) return [];
  let res: TextGenResponse;
  try {
    res = (await env.AI.run(NAME_MODEL, {
      messages: [
        { role: "system", content: STARTER_SYSTEM },
        { role: "user", content: `Taste notes:\n${text}\n\nPropose the vibes.` },
      ],
      max_tokens: 120,
      temperature: 0.4,
    })) as unknown as TextGenResponse;
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
    .replace(/^[-*\d.)\s]+/, "") // list markers
    .replace(/^["']|["']$/g, "")
    .replace(/[.]+$/, "")
    .trim();
  const words = cleaned.split(/\s+/).length;
  return cleaned && words >= 2 && words <= 10 ? cleaned : null;
}
