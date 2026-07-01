import { describe, it, expect } from "vitest";
import { handleSource, sourceUrl, UPSTREAM_SOURCE_URL } from "../src/source.js";
import type { Env } from "../src/env.js";

// The AGPL §13 source offer at `/source`. Open and tenant-clean: it states only the license and a
// link to the Corresponding Source — the upstream repo by default, or the operator's fork when the
// `SOURCE_URL` var is set (so a self-hoster who modified the Worker offers THEIR source).

const env = (SOURCE_URL?: string) => ({ SOURCE_URL }) as unknown as Pick<Env, "SOURCE_URL">;

describe("sourceUrl", () => {
  it("defaults to the upstream repository when SOURCE_URL is unset", () => {
    expect(sourceUrl(env())).toBe(UPSTREAM_SOURCE_URL);
  });

  it("uses the operator override, trimmed, when set", () => {
    expect(sourceUrl(env("  https://git.example.com/me/fork  "))).toBe("https://git.example.com/me/fork");
  });

  it("falls back to upstream for a blank/whitespace override", () => {
    expect(sourceUrl(env("   "))).toBe(UPSTREAM_SOURCE_URL);
  });
});

describe("handleSource", () => {
  it("returns an open 200 HTML page naming AGPL and linking the upstream source", async () => {
    const res = handleSource(env());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("Affero General Public License");
    expect(body).toContain(UPSTREAM_SOURCE_URL);
  });

  it("links the operator's fork when SOURCE_URL is set", async () => {
    const body = await handleSource(env("https://git.example.com/me/fork")).text();
    expect(body).toContain("https://git.example.com/me/fork");
    expect(body).not.toContain(UPSTREAM_SOURCE_URL);
  });

  it("HTML-escapes the (operator-controlled) URL so it can't break out of the attribute", async () => {
    const body = await handleSource(env('https://x/"><script>alert(1)</script>')).text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&quot;&gt;&lt;script&gt;");
  });
});
