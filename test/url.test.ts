import { describe, it, expect } from "vitest";
import { assertPublicHttpUrl, isPublicHttpUrl, UnsafeUrlError } from "../src/url.js";

// The egress guard (outbound-fetch-safety). Pure string/URL parsing — the one place the
// scheme/userinfo/private-host policy lives, shared by the fetch primitive (http.ts) and the
// write-time feed guard (corpus-db.ts). It is LITERAL-only by design (no DNS on workerd).

describe("assertPublicHttpUrl — allowed public targets", () => {
  for (const ok of [
    "http://example.com/recipe",
    "https://example.com/recipe",
    "https://sub.example.co.uk/a/b?c=d#e",
    "https://8.8.8.8/", // a public IP literal is fine
    "https://171.0.0.1/", // 171 is not in 172.16/12
    "https://192.169.0.1/", // not 192.168/16
    "https://172.15.0.1/", // just below 172.16/12
    "https://172.32.0.1/", // just above 172.16/12
  ]) {
    it(`allows ${ok}`, () => {
      expect(isPublicHttpUrl(ok)).toBe(true);
      expect(() => assertPublicHttpUrl(ok)).not.toThrow();
    });
  }
});

describe("assertPublicHttpUrl — refused schemes / userinfo / malformed", () => {
  it("refuses a non-http(s) scheme", () => {
    for (const bad of ["file:///etc/passwd", "ftp://example.com/x", "data:text/html,hi", "gopher://example.com"]) {
      expect(isPublicHttpUrl(bad)).toBe(false);
    }
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrowError(UnsafeUrlError);
  });

  it("refuses embedded credentials", () => {
    expect(isPublicHttpUrl("http://admin:secret@example.com/")).toBe(false);
    expect(isPublicHttpUrl("http://user@example.com/")).toBe(false);
  });

  it("refuses a malformed URL", () => {
    expect(isPublicHttpUrl("not a url")).toBe(false);
    expect(isPublicHttpUrl("")).toBe(false);
  });

  it("carries the specific reason", () => {
    expect(() => assertPublicHttpUrl("file:///x")).toThrowError(/Unsupported scheme/);
    try {
      assertPublicHttpUrl("http://a:b@example.com/");
    } catch (e) {
      expect((e as UnsafeUrlError).reason).toBe("userinfo");
    }
  });
});

describe("assertPublicHttpUrl — refused private IPv4 literals", () => {
  for (const bad of [
    "http://127.0.0.1/",
    "http://127.255.255.254/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.0.1/",
    "http://169.254.169.254/", // the cloud-metadata address
    "http://0.0.0.0/",
    "http://0.1.2.3/",
    "http://999.1.1.1/", // out-of-range quad → the URL parser throws → refused as malformed
  ]) {
    it(`refuses ${bad}`, () => {
      expect(isPublicHttpUrl(bad)).toBe(false);
    });
  }
});

describe("assertPublicHttpUrl — refused IPv6 + localhost", () => {
  for (const bad of [
    "http://[::1]/", // loopback
    "http://[::1]:8080/",
    "http://[::]/", // unspecified
    "http://[fc00::1]/", // unique-local
    "http://[fd12:3456::1]/", // unique-local
    "http://[fe80::1]/", // link-local
    "http://[febf::1]/", // link-local upper edge
    "http://[::ffff:127.0.0.1]/", // IPv4-mapped loopback
    "http://localhost/",
    "http://LocalHost:3000/",
    "http://api.localhost/",
    "http://localhost./", // FQDN-root trailing-dot form still resolves to loopback
    "http://api.localhost./",
    "http://127.0.0.1./", // trailing-dot IPv4 (parser strips the dot)
  ]) {
    it(`refuses ${bad}`, () => {
      expect(isPublicHttpUrl(bad)).toBe(false);
    });
  }

  it("allows a public IPv6 literal", () => {
    expect(isPublicHttpUrl("http://[2606:4700:4700::1111]/")).toBe(true); // public DNS
  });
});
