// @grocery-agent/contract — the runtime-agnostic code shared by the Worker
// (workerd) and the home-network satellite (Node): the recipe-parse spine and the
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
  CAPABILITIES,
  MAX_BATCH_ITEMS,
  RecipeItemSchema,
  RecipeObservationSchema,
  SaleObservationSchema,
  ObservationItemSchema,
  SatelliteBatchSchema,
  parseSatelliteBatch,
  parseObservationItem,
  parseRecipeItem,
  parseSaleObservation,
  parseSatelliteEnvelope,
  type Capability,
  type RecipeItem,
  type RecipeObservation,
  type SaleObservation,
  type ObservationItem,
  type SatelliteBatch,
  type NormalizedBatch,
  type ItemDisposition,
  type ItemResult,
  type BatchResponse,
  type PushResult,
  type ParseResult,
} from "./ingest.js";
export {
  TASK_SCOPES,
  TASK_STATUSES,
  TaskEnvelopeSchema,
  DEFAULT_CLAIM_MAX,
  MAX_CLAIM_TASKS,
  ClaimRequestSchema,
  SALE_SCAN_KIND,
  SaleScanPayloadSchema,
  parseClaimRequest,
  parseResultRequest,
  parseTaskEnvelope,
  parseSaleScanPayload,
  type TaskScope,
  type TaskStatus,
  type TaskEnvelope,
  type ClaimRequest,
  type ClaimResponse,
  type ResultRequest,
  type ResultResponse,
  type SaleScanPayload,
} from "./satellite-pull.js";
