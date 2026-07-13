// Workerd/browser-safe wire contract shared by the operation, member app, MCP, and
// typed Playwright fixtures. No environment, database, or credential imports.
export type InstacartHandoffErrorCode = "invalid_request" | "unauthorized" | "forbidden" | "rate_limited" | "upstream_unavailable" | "invalid_response";
export type InstacartHandoffResult =
  | { status: "ready"; url: string; expires_at: string; reused: boolean; item_count: number; underived: string[]; destination: "instacart_marketplace" }
  | { status: "empty"; item_count: 0; underived: string[] }
  | { status: "unavailable"; code: "not_configured" }
  | { status: "error"; code: InstacartHandoffErrorCode; retryable: boolean };
