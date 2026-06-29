import { describe, it, expect } from "vitest";
import { fetchWithBrowserHeaders, readTextCapped, MAX_BODY_BYTES } from "../src/http.js";

// The hardened egress primitive (outbound-fetch-safety). Exercised with an injected fetchImpl so
// no real network is touched: the guard runs before fetch, redirects are followed manually and
// re-validated per hop, and bodies are read under a cap.

const ok = (body: string, init?: ResponseInit) => new Response(body, { status: 200, ...init });
const redirectTo = (location: string) => new Response(null, { status: 302, headers: { location } });

describe("fetchWithBrowserHeaders — guard runs before connecting", () => {
  it("refuses a private/metadata host without calling fetch", async () => {
    let called = 0;
    const impl = (async () => {
      called++;
      return ok("x");
    }) as unknown as typeof fetch;
    await expect(fetchWithBrowserHeaders("http://169.254.169.254/latest/meta-data", impl)).rejects.toThrow();
    expect(called).toBe(0);
  });

  it("refuses a non-http scheme without calling fetch", async () => {
    let called = 0;
    const impl = (async () => {
      called++;
      return ok("x");
    }) as unknown as typeof fetch;
    await expect(fetchWithBrowserHeaders("file:///etc/passwd", impl)).rejects.toThrow();
    expect(called).toBe(0);
  });

  it("passes redirect:manual and an AbortSignal to fetch", async () => {
    let seen: RequestInit | undefined;
    const impl = (async (_u: string, init: RequestInit) => {
      seen = init;
      return ok("hello");
    }) as unknown as typeof fetch;
    const res = await fetchWithBrowserHeaders("https://example.com/", impl);
    expect(await res.text()).toBe("hello");
    expect(seen?.redirect).toBe("manual");
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it("propagates a fetch rejection (e.g. an abort/timeout) as a throw", async () => {
    const impl = (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    await expect(fetchWithBrowserHeaders("https://example.com/", impl)).rejects.toThrow();
  });
});

describe("fetchWithBrowserHeaders — manual redirects", () => {
  it("follows a public→public redirect, re-validating each hop", async () => {
    const calls: string[] = [];
    const impl = (async (u: string) => {
      calls.push(u);
      return calls.length === 1 ? redirectTo("https://final.example/p") : ok("done");
    }) as unknown as typeof fetch;
    const res = await fetchWithBrowserHeaders("https://start.example/", impl);
    expect(await res.text()).toBe("done");
    expect(calls).toEqual(["https://start.example/", "https://final.example/p"]);
  });

  it("resolves a relative redirect against the current host", async () => {
    const calls: string[] = [];
    const impl = (async (u: string) => {
      calls.push(u);
      return calls.length === 1 ? redirectTo("/landing") : ok("done");
    }) as unknown as typeof fetch;
    await fetchWithBrowserHeaders("https://start.example/recipes", impl);
    expect(calls[1]).toBe("https://start.example/landing");
  });

  it("blocks a redirect whose Location is a private host (only the first hop is fetched)", async () => {
    const calls: string[] = [];
    const impl = (async (u: string) => {
      calls.push(u);
      return redirectTo("http://127.0.0.1/admin");
    }) as unknown as typeof fetch;
    await expect(fetchWithBrowserHeaders("https://start.example/", impl)).rejects.toThrow();
    expect(calls).toEqual(["https://start.example/"]);
  });

  it("bounds an over-long redirect chain", async () => {
    let n = 0;
    const impl = (async () => {
      n++;
      return redirectTo(`https://h${n}.example/`);
    }) as unknown as typeof fetch;
    await expect(fetchWithBrowserHeaders("https://start.example/", impl)).rejects.toThrow(/Too many redirects/);
    expect(n).toBeLessThanOrEqual(6); // initial hop + MAX_REDIRECTS
  });
});

describe("readTextCapped", () => {
  it("rejects an over-cap Content-Length without reading the body", async () => {
    const fake = {
      headers: new Headers({ "content-length": String(MAX_BODY_BYTES + 1) }),
      body: null,
      text: async () => "should not be called",
    } as unknown as Response;
    await expect(readTextCapped(fake, 100)).rejects.toThrow(/too large/i);
  });

  it("caps a streamed body that omits Content-Length", async () => {
    const big = new TextEncoder().encode("x".repeat(500));
    const res = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(big);
          c.close();
        },
      }),
    );
    await expect(readTextCapped(res, 100)).rejects.toThrow(/exceeded/i);
  });

  it("returns text under the cap", async () => {
    const res = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("hello world"));
          c.close();
        },
      }),
    );
    expect(await readTextCapped(res, 100)).toBe("hello world");
  });
});
