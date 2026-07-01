// @grocery-agent/contract — the runtime-agnostic code shared by the Worker
// (workerd) and the home-network scraper (Node): the recipe-parse spine and the
// ingest wire contract. Nothing here may depend on a workerd-only API
// (HTMLRewriter) or a Node-only API (fs/Buffer) — layer-1 HTML extraction stays
// with each caller; only the pure normalize layer + the wire types live here.

export { cleanText, truncate, decodeEntities } from "./text.js";
export {
  findRecipe,
  normalizeRecipe,
  flattenInstructions,
  parseDurationMinutes,
  normalizeYield,
  type NormalizedRecipe,
  type NormalizeResult,
} from "./recipe-parse.js";
export {
  CONTRACT_VERSION,
  MAX_BATCH_ITEMS,
  RecipeItemSchema,
  IngestBatchSchema,
  IngestEnvelopeSchema,
  parseIngestBatch,
  parseRecipeItem,
  parseIngestEnvelope,
  type RecipeItem,
  type IngestBatch,
  type IngestEnvelope,
  type ItemDisposition,
  type ItemResult,
  type BatchResponse,
  type PushResult,
  type ParseResult,
} from "./ingest.js";
