import { describe, expect, it } from "vitest";
import { parseConfig, parseConfigToml } from "../src/config.js";

const VALID = `
connector_url = "https://mcp.example.workers.dev"
adapters_dir = "/config/adapters"
schedule = "6h"

[[sources]]
id = "paid-example"
adapter = "jsonld"
fetch_tier = "http"
sitemap_url = "https://paid.example/sitemap.xml"
mode = "incremental"

[[sources]]
id = "browser-example"
adapter = "jsonld"
fetch_tier = "browser"
feed_url = "https://browser.example/feed.xml"
`;

describe("parseConfigToml", () => {
  it("parses a valid config", () => {
    const cfg = parseConfigToml(VALID);
    expect(cfg.connector_url).toBe("https://mcp.example.workers.dev");
    expect(cfg.adapters_dir).toBe("/config/adapters");
    expect(cfg.schedule).toBe("6h");
    expect(cfg.sources).toHaveLength(2);
    expect(cfg.sources[0]).toMatchObject({
      id: "paid-example",
      adapter: "jsonld",
      fetch_tier: "http",
      sitemap_url: "https://paid.example/sitemap.xml",
      mode: "incremental",
    });
    expect(cfg.sources[1].fetch_tier).toBe("browser");
  });

  it("rejects malformed TOML", () => {
    expect(() => parseConfigToml("connector_url = ")).toThrow(/TOML parse error/);
  });
});

describe("parseConfig (shape validation)", () => {
  it("requires a connector_url", () => {
    expect(() => parseConfig({ sources: [{ id: "a", adapter: "jsonld" }] })).toThrow(/connector_url/);
  });

  it("rejects a non-http connector_url", () => {
    expect(() => parseConfig({ connector_url: "ftp://x", sources: [{ id: "a", adapter: "jsonld" }] })).toThrow(
      /valid http/,
    );
  });

  it("requires at least one source or scan_store", () => {
    expect(() => parseConfig({ connector_url: "https://x.example", sources: [] })).toThrow(/at least one/);
    expect(() => parseConfig({ connector_url: "https://x.example" })).toThrow(/at least one/);
  });

  it("accepts a machine that ONLY runs sale-scan (no recipe sources)", () => {
    const cfg = parseConfig({
      connector_url: "https://x.example",
      scan_stores: [{ store: "target", adapter: "target-sales", fetch_tier: "browser" }],
    });
    expect(cfg.sources).toEqual([]);
    expect(cfg.scan_stores).toEqual([{ store: "target", adapter: "target-sales", fetch_tier: "browser" }]);
  });

  it("validates scan_stores fields and rejects duplicates / bad tiers", () => {
    expect(() => parseConfig({ connector_url: "https://x.example", scan_stores: [{ adapter: "a" }] })).toThrow(/scan_stores\[0\]\.store/);
    expect(() => parseConfig({ connector_url: "https://x.example", scan_stores: [{ store: "s" }] })).toThrow(/scan_stores\[0\]\.adapter/);
    expect(() =>
      parseConfig({ connector_url: "https://x.example", scan_stores: [{ store: "s", adapter: "a", fetch_tier: "pigeon" }] }),
    ).toThrow(/fetch_tier/);
    expect(() =>
      parseConfig({
        connector_url: "https://x.example",
        scan_stores: [
          { store: "dup", adapter: "a" },
          { store: "dup", adapter: "b" },
        ],
      }),
    ).toThrow(/duplicate scan_stores/);
  });

  it("rejects an unknown fetch_tier", () => {
    expect(() =>
      parseConfig({
        connector_url: "https://x.example",
        sources: [{ id: "a", adapter: "jsonld", fetch_tier: "carrier-pigeon" }],
      }),
    ).toThrow(/fetch_tier/);
  });

  it("rejects a source missing its id", () => {
    expect(() =>
      parseConfig({ connector_url: "https://x.example", sources: [{ adapter: "jsonld" }] }),
    ).toThrow(/sources\[0\]\.id/);
  });

  it("rejects duplicate source ids", () => {
    expect(() =>
      parseConfig({
        connector_url: "https://x.example",
        sources: [
          { id: "dup", adapter: "jsonld" },
          { id: "dup", adapter: "jsonld" },
        ],
      }),
    ).toThrow(/duplicate source id/);
  });
});
