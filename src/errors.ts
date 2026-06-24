// Structured-error convention (design D4). Every tool returns a structured
// result, never a raw throw. The codes below are the enumerated set; later
// changes inherit this convention and may extend the set.

export type ErrorCode =
  | "not_found"
  | "index_unavailable"
  | "upstream_unavailable"
  | "malformed_data"
  | "unsupported"
  // Storage code (D1 data-access layer, src/db.ts):
  | "storage_error" // a D1 statement failed (constraint, malformed SQL, unreachable db); mapped from the raw D1 exception so no raw throw escapes
  // Write-path codes (introduced with the git write tools):
  | "validation_failed" // a staged change failed structural validation; nothing committed
  | "conflict" // the ref kept moving under us; commit abandoned after bounded retries
  // Order-placement codes (Change 06b):
  | "reauth_required" // the Kroger refresh token was rejected; re-run the one-time /oauth/init
  // Discovery codes (recipe-discovery capability):
  | "unreachable" // parse_recipe could not fetch the page (network error or non-2xx)
  | "no_jsonld" // the page exposed no <script type="application/ld+json"> blocks
  | "not_a_recipe" // JSON-LD was present but contained no schema.org Recipe
  | "incomplete" // a Recipe was found but yielded no ingredients or no instructions
  | "slug_exists" // create_recipe target already exists; not overwritten
  | "already_exists" // create_recipe source URL is already in the shared corpus; reuse the existing slug
  // Bug-reporting code (agent-bug-reporting capability):
  | "insufficient_permission" // the GitHub App lacks Issues: write; report_bug could not file
  // Weather codes (menu-generation capability):
  | "no_location" // get_weather_forecast: no ZIP resolvable from preferences
  | "forecast_unavailable" // get_weather_forecast: Open-Meteo returned non-2xx or network failure
  | "no_results"; // get_weather_forecast: geocoding returned no results for the given location

export interface ToolErrorShape {
  error: ErrorCode;
  message: string;
  [key: string]: unknown;
}

/** A typed error tools throw internally; serialized to a structured result at the tool boundary. */
export class ToolError extends Error {
  readonly code: ErrorCode;
  readonly context: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.context = context;
  }

  toShape(): ToolErrorShape {
    return { error: this.code, message: this.message, ...this.context };
  }
}

type McpResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Wrap successful structured data as an MCP tool result. */
export function ok(data: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/** Wrap a structured error as an MCP tool result flagged isError. */
export function fail(err: ToolErrorShape): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(err) }], isError: true };
}

/**
 * Run a tool body, converting any ToolError (or unexpected throw) into a
 * structured error result. This is the single enforcement point for D4.
 */
export async function runTool(body: () => Promise<unknown>): Promise<McpResult> {
  try {
    return ok(await body());
  } catch (e) {
    if (e instanceof ToolError) return fail(e.toShape());
    const message = e instanceof Error ? e.message : String(e);
    return fail({ error: "upstream_unavailable", message });
  }
}
