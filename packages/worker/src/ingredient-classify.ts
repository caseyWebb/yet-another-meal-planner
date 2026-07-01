// Ingredient identity CONFIRM for the organic-normalization capture job
// (organic-ingredient-normalization). Given a novel surface term and the nearest known
// canonical ids (from the embedding cosine), the small classifier disposes the identity
// into SAME (synonym) / SPECIALIZATION (base + a detail) / NOVEL, plus a `concrete` flag
// (false = a concept class) and proposed directed `satisfies` edges. Embedding proposes;
// this disposes — a cosine threshold alone fuses distinct products (baking-soda ~ 0.83
// baking-powder), so the classifier gate is mandatory.
//
// The prompt + the generality-direction rule are the conclusion of the design spike
// (design.md, "Spike findings"): mistral-small-3.1-24b passed 8/8 hard cases (refusing the
// danger merges, finding a synonym through noise, getting containment direction right,
// detecting the concept + excluding the non-member). Same env.AI + structured-error
// discipline as src/discovery-classify.ts, with the contract validator + a corrective retry.

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";

/** Confirm model — the spike's pick (shared with the discovery classifier). */
export const NORMALIZE_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

/** Max corrective retries on a contract-invalid confirm before the job fails safe to NOVEL. */
export const NORMALIZE_MAX_RETRIES = 2;

export type EdgeKind = "general" | "containment" | "membership";
export interface ConfirmEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

/** The classifier's decision. Ids are constructed by the JOB from `match` + `detail`, not
 *  trusted from the model, so the base stays in the registry's canonical form. */
export interface IdentityConfirm {
  outcome: "same" | "specialization" | "novel";
  /** For same/specialization: the candidate id (verbatim from the input list); null for novel. */
  match: string | null;
  /** For specialization: the distinguishing product detail as a kebab token (e.g. "fat-80-20"). */
  detail: string | null;
  /** false ⇒ a concept class ("a fresh soft cheese"), not a buyable product. */
  concrete: boolean;
  /** Proposed edges; endpoints are "NEW" (the term's node) or a candidate id. */
  edges: ConfirmEdge[];
  reason: string;
}

const EDGE_KINDS = new Set<EdgeKind>(["general", "containment", "membership"]);

const SYSTEM_PROMPT = [
  "You normalize grocery ingredient terms into a shared identity graph. Given a NEW term and a list of CANDIDATE known ingredient ids (from a fuzzy vector search whose list MAY contain irrelevant noise), decide how the new term relates to the known ingredients.",
  "",
  "An id is `base` or `base::detail`. A base is the general product; a detail narrows it to a spec that changes WHICH PRODUCT you would buy at the store.",
  "",
  'Return STRICT JSON only, no prose: {"outcome":"same"|"specialization"|"novel","match":"<candidate id, verbatim, or null>","detail":"<kebab detail for specialization, else null>","concrete":true|false,"edges":[{"from":"NEW"|"<candidate id>","to":"NEW"|"<candidate id>","kind":"general"|"containment"|"membership"}],"reason":"<short>"}',
  "",
  "Rules:",
  "- same: the new term is a synonym — the SAME product you would buy as a candidate (scallions = green onion). Set match to that candidate id.",
  "- specialization: the new term is a candidate's base product PLUS a spec that changes which SKU (80/20 ground beef specializes ground beef). Set match to that candidate id and detail to a short kebab token (e.g. fat-80-20, type-bread).",
  "- novel: none of the candidates is the same product. Set match and detail to null. This INCLUDES distinct varieties that merely resemble a candidate: cheddar is NOT mozzarella, baking soda is NOT baking powder, chicken broth is NOT vegetable broth.",
  "- Be CONSERVATIVE. Only pick same when truly interchangeable at the store. When in doubt prefer specialization or novel. Never collapse two distinct products.",
  "- GENERALITY DIRECTION: never pick same when the new term is MORE GENERAL than a candidate. A general product (mozzarella cheese) is NOT a synonym of one of its specific varieties (fresh mozzarella) — choose novel and mint the general base instead. When you mint a general base over candidates that are its specific varieties, ALSO add a general edge FROM each such variety TO the new base: {\"from\":\"<variety>\",\"to\":\"NEW\",\"kind\":\"general\"}. A general edge is DIRECTIONAL like containment — a specific variety satisfies a request for the general product (kielbasa satisfies sausage), but the general product does NOT satisfy a request for the variety.",
  "- PREPARATION words that do not change the product (diced, minced, shredded, softened, chopped) are NOT details: pick same on the base product (diced yellow onion = yellow onion).",
  "- CONTAINMENT edges are DIRECTIONAL: a more complete form satisfies a request for a sub-part. A whole chicken satisfies chicken thighs, but a thigh does NOT satisfy a whole chicken — emit {\"from\":\"<whole>\",\"to\":\"NEW\",\"kind\":\"containment\"}, never the reverse.",
  "- concrete=false only for a generic CLASS (a fresh soft cheese); then add membership edges FROM fitting candidate members TO the new concept: {\"from\":\"<member>\",\"to\":\"NEW\",\"kind\":\"membership\"}.",
  "- Ignore irrelevant noise candidates.",
].join("\n");

type Msg = { role: "system" | "user" | "assistant"; content: string };

const FEW_SHOT: { user: string; out: IdentityConfirm }[] = [
  {
    user: 'NEW term: "scallions"\nCANDIDATES: ["all-purpose flour","cilantro","green onion"]',
    out: { outcome: "same", match: "green onion", detail: null, concrete: true, edges: [], reason: "synonym of green onion" },
  },
  {
    user: 'NEW term: "80/20 ground beef"\nCANDIDATES: ["ground beef","lean ground beef"]',
    out: { outcome: "specialization", match: "ground beef", detail: "fat-80-20", concrete: true, edges: [], reason: "ground beef at a specific fat ratio" },
  },
  {
    user: 'NEW term: "baking powder"\nCANDIDATES: ["baking soda","flour"]',
    out: { outcome: "novel", match: null, detail: null, concrete: true, edges: [], reason: "distinct product from baking soda" },
  },
  {
    // A GENERAL base arriving over specific varieties: mint the base novel AND back-link each
    // variety to it with a directional general edge (kielbasa satisfies sausage, not the reverse).
    user: 'NEW term: "sausage"\nCANDIDATES: ["kielbasa","andouille","bratwurst"]',
    out: {
      outcome: "novel",
      match: null,
      detail: null,
      concrete: true,
      edges: [
        { from: "kielbasa", to: "NEW", kind: "general" },
        { from: "andouille", to: "NEW", kind: "general" },
        { from: "bratwurst", to: "NEW", kind: "general" },
      ],
      reason: "general sausage base; each candidate variety satisfies it",
    },
  },
];

function messages(term: string, candidates: string[]): Msg[] {
  const msgs: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const ex of FEW_SHOT) {
    msgs.push({ role: "user", content: ex.user });
    msgs.push({ role: "assistant", content: JSON.stringify(ex.out) });
  }
  msgs.push({ role: "user", content: `NEW term: ${JSON.stringify(term)}\nCANDIDATES: ${JSON.stringify(candidates)}` });
  return msgs;
}

function parseJson(response: unknown): Record<string, unknown> | null {
  if (response && typeof response === "object") return response as Record<string, unknown>;
  if (typeof response !== "string") return null;
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const v = JSON.parse(response.slice(start, end + 1));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Validate + coerce a raw model object into an IdentityConfirm, or return the reasons it failed. */
export function validateConfirm(
  raw: Record<string, unknown>,
  candidates: string[],
): { ok: true; confirm: IdentityConfirm } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const outcome = raw.outcome;
  if (outcome !== "same" && outcome !== "specialization" && outcome !== "novel") {
    errors.push('outcome must be "same", "specialization", or "novel"');
  }
  const known = new Set(candidates);
  const match = typeof raw.match === "string" && raw.match ? raw.match : null;
  if ((outcome === "same" || outcome === "specialization") && (!match || !known.has(match))) {
    errors.push("match must be one of the candidate ids for same/specialization");
  }
  const detail = typeof raw.detail === "string" && raw.detail.trim() ? raw.detail.trim() : null;
  if (outcome === "specialization" && !detail) errors.push("specialization requires a non-empty detail");
  const concrete = raw.concrete !== false; // default concrete unless explicitly false
  const edges: ConfirmEdge[] = [];
  if (Array.isArray(raw.edges)) {
    for (const e of raw.edges) {
      if (!e || typeof e !== "object") continue;
      const { from, to, kind } = e as Record<string, unknown>;
      if (typeof from !== "string" || typeof to !== "string" || typeof kind !== "string") continue;
      if (!EDGE_KINDS.has(kind as EdgeKind)) continue;
      const endpointOk = (x: string) => x === "NEW" || known.has(x);
      if (!endpointOk(from) || !endpointOk(to)) continue; // drop edges to unknown ids (conservative)
      edges.push({ from, to, kind: kind as EdgeKind });
    }
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    confirm: {
      outcome: outcome as IdentityConfirm["outcome"],
      match,
      detail,
      concrete,
      edges,
      reason: typeof raw.reason === "string" ? raw.reason : "",
    },
  };
}

async function runModel(env: Env, msgs: Msg[]): Promise<Record<string, unknown> | null> {
  let res: { response?: unknown };
  try {
    res = (await env.AI.run(NORMALIZE_MODEL, { messages: msgs, max_tokens: 300, temperature: 0 })) as {
      response?: unknown;
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("storage_error", `Workers AI identity confirm failed: ${message}`, { model: NORMALIZE_MODEL });
  }
  return parseJson(res?.response);
}

/**
 * Confirm a term's identity against its nearest known candidates, with a corrective retry on a
 * contract-invalid response. Throws a structured `validation_failed` ToolError when the model
 * can't produce a valid confirm within the retry budget (the job catches it and fails safe to a
 * NOVEL mint — fragment, never mis-collapse). A `storage_error` (AI outage) propagates so the job
 * leaves the term queued.
 */
export async function confirmIdentity(
  env: Env,
  term: string,
  candidates: string[],
  maxRetries: number = NORMALIZE_MAX_RETRIES,
): Promise<IdentityConfirm> {
  const msgs = messages(term, candidates);
  let lastErrors: string[] = ["model did not return a JSON object"];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await runModel(env, msgs);
    if (raw) {
      const v = validateConfirm(raw, candidates);
      if (v.ok) return v.confirm;
      lastErrors = v.errors;
      msgs.push({ role: "assistant", content: JSON.stringify(raw) });
      msgs.push({
        role: "user",
        content: `That failed validation:\n- ${lastErrors.join("\n- ")}\nReturn the corrected JSON object only.`,
      });
    } else {
      msgs.push({ role: "user", content: "Return ONLY a single JSON object, no prose." });
    }
  }
  throw new ToolError("validation_failed", `Identity confirm invalid after ${maxRetries + 1} attempts: ${lastErrors.join("; ")}`, {
    errors: lastErrors,
  });
}
