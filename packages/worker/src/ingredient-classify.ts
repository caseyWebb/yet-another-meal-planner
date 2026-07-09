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
import { runAi } from "./ai.js";

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

/** A retrieval candidate shown to the confirm: the id plus its cosine to the term (absent for
 *  the co-resolution pass, whose pairing signal is a shared SKU, not embedding distance). */
export interface ScoredCandidate {
  id: string;
  score?: number;
}

/** The classifier's decision. Ids are constructed by the JOB from `match` + `detail`, not
 *  trusted from the model, so the base stays in the registry's canonical form. */
export interface IdentityConfirm {
  outcome: "same" | "specialization" | "novel";
  /** For same/specialization: the candidate id (verbatim from the input list); null for novel. */
  match: string | null;
  /** For specialization: the distinguishing product detail as a kebab token (e.g. "fat-80-20"). */
  detail: string | null;
  /** For novel: the proposed clean product id (noise stripped). ADVISORY — the job validates it
   *  and falls back to the verbatim term; it never fails validation here. */
  canonical: string | null;
  /** false ⇒ a concept class ("a fresh soft cheese"), not a buyable product. */
  concrete: boolean;
  /** Proposed edges; endpoints are "NEW" (the term's node) or a candidate id. */
  edges: ConfirmEdge[];
  /** A concise human-facing display label for the NEW term (Title-case natural name, e.g.
   *  "Red cabbage", "80/20 ground beef"). ADVISORY — validated as a clean short string; the JOB
   *  threads it onto the minted node's `display_name`, and null/absent degrades to the `base
   *  (detail)` synthesis. NEVER a matcher input or a join key. */
  display_name?: string | null;
  reason: string;
}

/** Max length for a classifier-proposed display label (a short name, not prose). */
const DISPLAY_NAME_MAX_LENGTH = 60;

const EDGE_KINDS = new Set<EdgeKind>(["general", "containment", "membership"]);

const SYSTEM_PROMPT = [
  "You normalize grocery ingredient terms into a shared identity graph. Given a NEW term and a list of CANDIDATE known ingredient ids (from a fuzzy vector search whose list MAY contain irrelevant noise), each with its cosine similarity to the new term when available, decide how the new term relates to the known ingredients.",
  "",
  "An id is `base` or `base::detail`. A base is the general product; a detail narrows it to a spec that changes WHICH PRODUCT you would buy at the store.",
  "",
  'Return STRICT JSON only, no prose: {"outcome":"same"|"specialization"|"novel","match":"<candidate id, verbatim, or null>","detail":"<kebab detail for specialization, else null>","canonical":"<clean product id for novel, else null>","concrete":true|false,"edges":[{"from":"NEW"|"<candidate id>","to":"NEW"|"<candidate id>","kind":"general"|"containment"|"membership"}],"display_name":"<concise human label for the NEW term>","reason":"<short>"}',
  "",
  "Rules:",
  "- same: the new term is a synonym — the SAME product you would buy as a candidate (scallions = green onion). Set match to that candidate id.",
  "- specialization: the new term is a candidate's base product PLUS a spec that changes which SKU (80/20 ground beef specializes ground beef). Set match to that candidate id and detail to a short kebab token (e.g. fat-80-20, type-bread).",
  "- novel: none of the candidates is the same product. Set match and detail to null. This INCLUDES distinct varieties that merely resemble a candidate: cheddar is NOT mozzarella, baking soda is NOT baking powder, chicken broth is NOT vegetable broth.",
  "- A DISTINCT PRODUCT is NEVER a specialization of a lookalike. A specialization's detail narrows the SAME base product; it must not attach a different product to a similar-sounding candidate. Dried dates are NOT a variety of a dried fruit blend; canned salmon is NOT a form of fresh skin-on salmon fillets; a loaf of bread is NOT a type of bread flour; a sea salt is NOT a kind of fish sauce. When the products differ, choose novel.",
  "- A home-derived EXTRACTION that is ALSO a distinct purchasable product in its own right (lime juice — sold bottled) is a DISTINCT BASE: it is NEVER same as its source product, in EITHER direction (lime juice is not lime; lime is not lime juice), and never a specialization of it. Choose novel (or the standing extraction candidate).",
  "- Each candidate's similarity is its retrieval cosine to the new term. LOW similarity means the retriever considers it distant: the lower it is, the stronger the product-identity evidence must be before you pick same or specialization against it — when similarity is low and identity is not obvious, choose novel.",
  '- For a novel outcome, ALSO set canonical to the clean store-product name for the new term: lowercase, packaging/quantity/storage-condition noise stripped (parentheticals, bag sizes, "frozen leftovers", "freezer burned"), as `base` or `base::detail`. If the term is already a clean product name, canonical may repeat it. canonical is null for same/specialization.',
  "- Be CONSERVATIVE. Only pick same when truly interchangeable at the store. When in doubt prefer specialization or novel. Never collapse two distinct products.",
  '- PURCHASABLE DISTINCTION: a qualifier is load-bearing (a detail) ONLY when the qualified form is a DIFFERENT product on the store shelf a shopper would buy (fat ratio, flour type, egg size, a varietal, or a canned/dried/pickled/ground/toasted form sold as its own SKU: pickle chips, canned tuna, dried thyme, cinnamon sticks). A PREPARATION or CUT form the shopper derives at home from the purchased base by ordinary kitchen work (diced, minced, shredded, softened, chopped, wedges, slices, quarters, zest) is NOT a detail: pick same on the base product (lime wedges = lime; diced yellow onion = yellow onion) — the form serves the recipe, not the store; it names the same purchase. Judge purchasability PER PRODUCT, not by word list: the SAME word may dispose either way ("diced tomatoes" names a canned shelf product — a specialization; "diced yellow onion" is knife work — same).',
  "- GENERALITY DIRECTION: never pick same when the new term is MORE GENERAL than a candidate. A general product (mozzarella cheese) is NOT a synonym of one of its specific varieties (fresh mozzarella) — choose novel and mint the general base instead. When you mint a general base over candidates that are its specific varieties, ALSO add a general edge FROM each such variety TO the new base: {\"from\":\"<variety>\",\"to\":\"NEW\",\"kind\":\"general\"}. A general edge is DIRECTIONAL like containment — a specific variety satisfies a request for the general product (kielbasa satisfies sausage), but the general product does NOT satisfy a request for the variety.",
  "- A term that differs from a candidate id only by punctuation, pluralization, or word order is the SAME product — pick same (salmon fillets skin-on = salmon fillets, skin-on).",
  "- CONTAINMENT edges are DIRECTIONAL: a more complete form satisfies a request for a sub-part. A whole chicken satisfies chicken thighs, but a thigh does NOT satisfy a whole chicken — emit {\"from\":\"<whole>\",\"to\":\"NEW\",\"kind\":\"containment\"}, never the reverse.",
  "- concrete=false only for a generic CLASS (a fresh soft cheese); then add membership edges FROM fitting candidate members TO the new concept: {\"from\":\"<member>\",\"to\":\"NEW\",\"kind\":\"membership\"}.",
  '- A DISJUNCTION is never a product: a term of the form "X or Y" names acceptable alternatives (a purchase constraint), not a buyable product. Deterministic code disposes such terms before you see them; if one reaches you anyway, choose novel with concrete=false, and NEVER propose a canonical containing " or " between product names.',
  "- Ignore irrelevant noise candidates.",
  '- ALWAYS set display_name to a concise, human-friendly label for the NEW term: a natural, Title-case name a shopper would recognize on a list (e.g. "Red cabbage", "80/20 ground beef", "Cheddar cheese", "Half and half"). Keep it short — strip packaging/quantity/storage noise and parentheticals, no trailing punctuation. This is a DISPLAY label ONLY; it is NEVER used for matching, search, or as an id — so it may read naturally where the id is kebab-case.',
].join("\n");

type Msg = { role: "system" | "user" | "assistant"; content: string };

const FEW_SHOT: { user: string; out: IdentityConfirm }[] = [
  {
    user: 'NEW term: "scallions"\nCANDIDATES: [{"id":"all-purpose flour","similarity":0.41},{"id":"cilantro","similarity":0.62},{"id":"green onion","similarity":0.84}]',
    out: { outcome: "same", match: "green onion", detail: null, canonical: null, concrete: true, edges: [], display_name: "Green onions", reason: "synonym of green onion" },
  },
  {
    user: 'NEW term: "80/20 ground beef"\nCANDIDATES: [{"id":"ground beef","similarity":0.88},{"id":"lean ground beef","similarity":0.83}]',
    out: { outcome: "specialization", match: "ground beef", detail: "fat-80-20", canonical: null, concrete: true, edges: [], display_name: "80/20 ground beef", reason: "ground beef at a specific fat ratio" },
  },
  {
    user: 'NEW term: "baking powder"\nCANDIDATES: [{"id":"baking soda","similarity":0.83},{"id":"flour","similarity":0.55}]',
    out: { outcome: "novel", match: null, detail: null, canonical: "baking powder", concrete: true, edges: [], display_name: "Baking powder", reason: "distinct product from baking soda" },
  },
  {
    // A distinct product over a lookalike candidate, from noisy pantry free-text: novel (never a
    // specialization of the lookalike), with the noise stripped into the canonical.
    user: 'NEW term: "dried medjool dates (pitted)"\nCANDIDATES: [{"id":"dried fruit blend","similarity":0.74},{"id":"raisins","similarity":0.66}]',
    out: { outcome: "novel", match: null, detail: null, canonical: "medjool dates", concrete: true, edges: [], display_name: "Medjool dates", reason: "dates are a distinct product, not a dried fruit blend variety" },
  },
  {
    // A punctuation-only variant of an existing node: SAME, never a duplicate mint (the live
    // defect: 'salmon fillets skin-on' minted beside 'salmon fillets, skin-on' at cosine 0.98).
    user: 'NEW term: "salmon fillets skin-on"\nCANDIDATES: [{"id":"salmon fillets, skin-on","similarity":0.98},{"id":"canned salmon","similarity":0.71}]',
    out: {
      outcome: "same",
      match: "salmon fillets, skin-on",
      detail: null,
      canonical: null,
      concrete: true,
      edges: [],
      display_name: "Salmon fillets, skin-on",
      reason: "punctuation-only variant of the same product",
    },
  },
  {
    // A GENERAL base arriving over specific varieties: mint the base novel AND back-link each
    // variety to it with a directional general edge (kielbasa satisfies sausage, not the reverse).
    user: 'NEW term: "sausage"\nCANDIDATES: [{"id":"kielbasa","similarity":0.78},{"id":"andouille","similarity":0.74},{"id":"bratwurst","similarity":0.73}]',
    out: {
      outcome: "novel",
      match: null,
      detail: null,
      canonical: "sausage",
      concrete: true,
      edges: [
        { from: "kielbasa", to: "NEW", kind: "general" },
        { from: "andouille", to: "NEW", kind: "general" },
        { from: "bratwurst", to: "NEW", kind: "general" },
      ],
      display_name: "Sausage",
      reason: "general sausage base; each candidate variety satisfies it",
    },
  },
  {
    // A home-derivable cut form: never a detail — SAME on the base (the live defect: 'lime
    // wedges' minted lime::form-wedges, hiding the pantry lime from exact-id matching).
    user: 'NEW term: "lime wedges"\nCANDIDATES: [{"id":"lime","similarity":0.89},{"id":"lime juice","similarity":0.78},{"id":"lemon","similarity":0.72}]',
    out: {
      outcome: "same",
      match: "lime",
      detail: null,
      canonical: null,
      concrete: true,
      edges: [],
      display_name: "Lime",
      reason: "wedges are knife work on the purchased lime, not a shelf product",
    },
  },
  {
    // The purchasable contrast for the same word: unlike knife-work 'diced yellow onion',
    // canned diced tomatoes are their own shelf SKU — the qualifier IS load-bearing here.
    user: 'NEW term: "diced tomatoes"\nCANDIDATES: [{"id":"tomatoes","similarity":0.9},{"id":"tomato paste","similarity":0.77}]',
    out: {
      outcome: "specialization",
      match: "tomatoes",
      detail: "form-diced",
      canonical: null,
      concrete: true,
      edges: [],
      display_name: "Diced tomatoes",
      reason: "canned diced tomatoes are a distinct shelf product, not knife work",
    },
  },
];

/** The candidate as the prompt shows it: id + rounded similarity (omitted when unscored). */
function promptCandidate(c: ScoredCandidate): { id: string; similarity?: number } {
  return c.score === undefined ? { id: c.id } : { id: c.id, similarity: Math.round(c.score * 1000) / 1000 };
}

function messages(term: string, candidates: ScoredCandidate[]): Msg[] {
  const msgs: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const ex of FEW_SHOT) {
    msgs.push({ role: "user", content: ex.user });
    msgs.push({ role: "assistant", content: JSON.stringify(ex.out) });
  }
  msgs.push({
    role: "user",
    content: `NEW term: ${JSON.stringify(term)}\nCANDIDATES: ${JSON.stringify(candidates.map(promptCandidate))}`,
  });
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
  // Advisory only — the JOB validates the canonical and falls back to the verbatim term, so a
  // malformed value must never fail the contract (or burn a corrective retry).
  const canonical = typeof raw.canonical === "string" && raw.canonical.trim() ? raw.canonical.trim() : null;
  // Advisory, like `canonical` — a clean short label or null; never fails the contract (or burns a
  // corrective retry). The JOB threads it onto the node; a null/absent value degrades to synthesis.
  const displayName =
    typeof raw.display_name === "string" &&
    raw.display_name.trim() &&
    raw.display_name.trim().length <= DISPLAY_NAME_MAX_LENGTH &&
    !/[\n\r]/.test(raw.display_name)
      ? raw.display_name.trim()
      : null;
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
      canonical,
      concrete,
      edges,
      display_name: displayName,
      reason: typeof raw.reason === "string" ? raw.reason : "",
    },
  };
}

async function runModel(env: Env, msgs: Msg[]): Promise<Record<string, unknown> | null> {
  let res: { response?: unknown };
  try {
    res = await runAi<{ response?: unknown }>(
      env,
      { activity: "ingredient-confirm", trigger: "cron", calls: 1 },
      NORMALIZE_MODEL,
      { messages: msgs, max_tokens: 300, temperature: 0 },
    );
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
  candidates: ScoredCandidate[],
  maxRetries: number = NORMALIZE_MAX_RETRIES,
): Promise<IdentityConfirm> {
  const msgs = messages(term, candidates);
  const candidateIds = candidates.map((c) => c.id);
  let lastErrors: string[] = ["model did not return a JSON object"];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await runModel(env, msgs);
    if (raw) {
      const v = validateConfirm(raw, candidateIds);
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

// --- satisfies-direction check (normalization-decision-reaudit) --------------
// The edge re-audit's cheap validator: given a standing (or 2-cycle) satisfies edge FROM → TO,
// which direction does satisfaction actually hold in? Same env.AI + contract discipline as the
// identity confirm above (strict JSON, corrective retry, storage_error/validation_failed split),
// and the same hardened distinct-product rules — a superficially-similar product is NOT a
// substitute, which is exactly the class of pre-hardening edge this pass exists to drop.

/** The direction verdict for a FROM/TO pair: which way "having X satisfies a request for Y" holds. */
export type SatisfiesDirection = "forward" | "reverse" | "both" | "neither";

export interface DirectionCheck {
  direction: SatisfiesDirection;
  reason: string;
}

const DIRECTION_VALUES = new Set<SatisfiesDirection>(["forward", "reverse", "both", "neither"]);

const DIRECTION_SYSTEM_PROMPT = [
  "You audit directed substitution edges in a grocery ingredient identity graph. An edge FROM → TO means: a shopper who has FROM on hand can ACCEPTABLY FULFILL a recipe or shopping request for TO. Satisfaction means 'acceptably fulfills a request for' — NOT 'is the identical product'. Given ingredients FROM and TO, decide in which direction satisfaction truly holds.",
  "",
  'Return STRICT JSON only, no prose: {"direction":"forward"|"reverse"|"both"|"neither","reason":"<short>"}',
  "",
  "Rules:",
  "- forward: having FROM satisfies a request for TO (and not the other way around).",
  "- reverse: having TO satisfies a request for FROM (and not the other way around).",
  "- both: truly interchangeable at the store — either satisfies the other.",
  "- neither: neither satisfies the other.",
  "- A more complete form satisfies its derived form, never the reverse: whole spices satisfy a ground-spice request (they can be ground), a whole chicken satisfies chicken thighs; ground cannot become whole, a thigh is not a whole bird.",
  "- A specific variety or member satisfies its general product or category (kielbasa satisfies sausage; a habanero sauce satisfies a request for hot sauces), but the general product or category does NOT satisfy a request for the specific variety.",
  "- MEMBERSHIP: when TO names a category or concept, ask whether FROM is a member that would acceptably fill a request for that category — the member does not have to EQUAL the category, it has to belong to it.",
  "- DISTINCT SPECIFIC PRODUCTS at the same level of generality do not satisfy each other, however similar they look: different flours (semolina is not all-purpose), a different packing medium (tuna in oil is not tuna in water), an ingredient FOR MAKING a product is not the product (fruit pectin is not jam; a raw hot pepper is not a hot sauce; garlic powder is not italian seasoning), a different preservation state (frozen fruit is not dried fruit), a different shape a shopper would not accept (spaghetti is not rigatoni). Do NOT use this rule to deny a specific→general/category direction or a whole→derived direction.",
  "- Be CONSERVATIVE: when satisfaction is not clearly true in a direction, do not claim it.",
].join("\n");

const DIRECTION_FEW_SHOT: { user: string; out: DirectionCheck }[] = [
  {
    user: 'FROM: "whole cardamom pods"\nTO: "ground cardamom"',
    out: { direction: "forward", reason: "whole pods can be ground; ground cannot become whole pods" },
  },
  {
    user: 'FROM: "ground nutmeg"\nTO: "whole nutmeg"',
    out: { direction: "reverse", reason: "whole nutmeg grinds down; ground cannot substitute for whole" },
  },
  {
    user: 'FROM: "semolina flour"\nTO: "all-purpose flour"',
    out: { direction: "neither", reason: "distinct flours; substituting changes the product" },
  },
  {
    user: 'FROM: "kielbasa"\nTO: "sausage"',
    out: { direction: "forward", reason: "a specific variety satisfies the general product, not the reverse" },
  },
  {
    // Production mistake class: a coated/flavored form of the SAME product still fulfills it.
    user: 'FROM: "honey raisins"\nTO: "raisins"',
    out: { direction: "forward", reason: "honey raisins are still raisins; they fulfill a raisin request" },
  },
  {
    // Production mistake class: a member fulfills a request for its category concept.
    user: 'FROM: "sweet maui mango habanero sauce"\nTO: "hot sauces (various)"',
    out: { direction: "forward", reason: "a habanero sauce is a hot sauce; a member fulfills the category" },
  },
  {
    // True drop: an ingredient FOR MAKING the category is not a member of it.
    user: 'FROM: "fruit pectin"\nTO: "jellies and jams (various)"',
    out: { direction: "neither", reason: "an ingredient for making jam is not jam" },
  },
  {
    // True drop: a different preservation state changes the product.
    user: 'FROM: "frozen fruit mix"\nTO: "dried fruit blend"',
    out: { direction: "neither", reason: "frozen fruit is not dried fruit; substituting changes the product" },
  },
];

/** Validate + coerce a raw model object into a DirectionCheck, or return the reasons it failed. */
export function validateDirection(
  raw: Record<string, unknown>,
): { ok: true; check: DirectionCheck } | { ok: false; errors: string[] } {
  const direction = raw.direction;
  if (typeof direction !== "string" || !DIRECTION_VALUES.has(direction as SatisfiesDirection)) {
    return { ok: false, errors: ['direction must be "forward", "reverse", "both", or "neither"'] };
  }
  return {
    ok: true,
    check: {
      direction: direction as SatisfiesDirection,
      reason: typeof raw.reason === "string" ? raw.reason : "",
    },
  };
}

/**
 * Check which way satisfaction holds between an edge's endpoints (their readable forms). Throws
 * `validation_failed` when the model can't produce a valid verdict within the retry budget (the
 * edge audit catches it and keeps the edge — never a delete on an undecidable) and lets a
 * `storage_error` (AI outage) propagate so the edge stays un-stamped for a later tick.
 */
export async function confirmSatisfiesDirection(
  env: Env,
  from: string,
  to: string,
  maxRetries: number = NORMALIZE_MAX_RETRIES,
): Promise<DirectionCheck> {
  const msgs: Msg[] = [{ role: "system", content: DIRECTION_SYSTEM_PROMPT }];
  for (const ex of DIRECTION_FEW_SHOT) {
    msgs.push({ role: "user", content: ex.user });
    msgs.push({ role: "assistant", content: JSON.stringify(ex.out) });
  }
  msgs.push({ role: "user", content: `FROM: ${JSON.stringify(from)}\nTO: ${JSON.stringify(to)}` });
  let lastErrors: string[] = ["model did not return a JSON object"];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await runModel(env, msgs);
    if (raw) {
      const v = validateDirection(raw);
      if (v.ok) return v.check;
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
  throw new ToolError(
    "validation_failed",
    `Satisfies-direction check invalid after ${maxRetries + 1} attempts: ${lastErrors.join("; ")}`,
    { errors: lastErrors },
  );
}
