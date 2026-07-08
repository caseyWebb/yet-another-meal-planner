// The Access-expiry fetch classifier (admin-spa D7): the one place a Playwright suite cannot
// honestly reach (no real Access flow in the harness), so it is pinned here — HTML and
// redirect artifacts are `expired`; JSON results, structured JSON errors, and the plain-404
// unknown-route response are NOT.
import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyAdminResponse, adminFetch, AccessExpiredError, accessExpiredSnapshot } from "./api";

function res(init: { status?: number; contentType?: string; type?: string }): Response {
  const r = new Response("x", {
    status: init.status ?? 200,
    headers: init.contentType ? { "content-type": init.contentType } : {},
  });
  if (init.type) Object.defineProperty(r, "type", { value: init.type });
  return r;
}

describe("classifyAdminResponse", () => {
  it("passes JSON results through", () => {
    expect(classifyAdminResponse(res({ contentType: "application/json" }))).toBe("ok");
  });

  it("passes a structured JSON error through (a ToolError is data, not expiry)", () => {
    expect(classifyAdminResponse(res({ status: 400, contentType: "application/json" }))).toBe("ok");
  });

  it("passes the unknown-API-route plain 404 through (D2 keeps it text, never HTML)", () => {
    expect(classifyAdminResponse(res({ status: 404, contentType: "text/plain;charset=UTF-8" }))).toBe("ok");
  });

  it("classifies an HTML body as expired (the Access interstitial / any shell leak)", () => {
    expect(classifyAdminResponse(res({ contentType: "text/html; charset=utf-8" }))).toBe("expired");
  });

  it("classifies an opaque redirect as expired (the IdP bounce)", () => {
    expect(classifyAdminResponse(res({ type: "opaqueredirect" }))).toBe("expired");
  });
});

describe("adminFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws AccessExpiredError and flips the flag on a network failure (the CORS-killed redirect)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(adminFetch("/admin/api/status")).rejects.toBeInstanceOf(AccessExpiredError);
    expect(accessExpiredSnapshot()).toBe(true);
  });

  it("throws AccessExpiredError on an HTML response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ contentType: "text/html" })));
    await expect(adminFetch("/admin/api/status")).rejects.toBeInstanceOf(AccessExpiredError);
  });

  it("returns JSON responses untouched — including structured-error statuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ status: 400, contentType: "application/json" })));
    const r = await adminFetch("/admin/api/status");
    expect(r.status).toBe(400);
  });
});
