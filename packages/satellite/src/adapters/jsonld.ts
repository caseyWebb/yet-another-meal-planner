// The built-in GENERIC adapter (`adapter = "jsonld"`). It is the config-only path: a source
// that exposes a sitemap or RSS/Atom feed AND serves authenticated pages carrying schema.org
// JSON-LD needs no custom code — `discover` reads the feed for candidate URLs and `extract`
// runs the shared JSON-LD parse. Site-specific extraction (a source without usable structured
// data) is an operator-authored adapter, not this one.

import { XMLParser } from "fast-xml-parser";
import type { RecipeItem } from "@grocery-agent/contract";
import type { SourceAdapter, Sdk } from "../adapter.js";

/**
 * A tolerant XML parser for sitemaps and feeds. `<url>`/`<item>`/`<entry>` collections may be
 * one element or many; without alwaysArray the parser collapses a single element to an object,
 * so we normalize with `asArray` below rather than configuring per-tag array coercion.
 */
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

/** Coerce a parser value (missing | one | many) to an array. */
function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Pull an href out of an Atom `<link>` (string, object with @_href, or an array of either). */
function atomLinkHref(link: unknown): string | null {
  for (const l of asArray(link)) {
    if (typeof l === "string") return l;
    if (l && typeof l === "object") {
      const o = l as Record<string, unknown>;
      // Prefer rel="alternate"; fall back to the first href.
      if (typeof o["@_href"] === "string" && (o["@_rel"] === "alternate" || o["@_rel"] === undefined)) {
        return o["@_href"];
      }
    }
  }
  // Second pass: any href at all.
  for (const l of asArray(link)) {
    if (l && typeof l === "object" && typeof (l as Record<string, unknown>)["@_href"] === "string") {
      return (l as Record<string, unknown>)["@_href"] as string;
    }
  }
  return null;
}

/**
 * Extract candidate recipe URLs from a sitemap.xml, an RSS 2.0 feed, or an Atom feed.
 * Exported for unit testing against fixtures. Order is preserved and duplicates removed.
 */
export function extractUrlsFromXml(body: string): string[] {
  const doc = xml.parse(body) as Record<string, unknown>;
  const urls: string[] = [];

  // sitemap: <urlset><url><loc>…</loc></url>…
  const urlset = doc.urlset as Record<string, unknown> | undefined;
  if (urlset) {
    for (const u of asArray(urlset.url as unknown)) {
      const loc = (u as Record<string, unknown>)?.loc;
      if (typeof loc === "string" && loc.trim()) urls.push(loc.trim());
    }
  }
  // sitemap index: <sitemapindex><sitemap><loc>…</loc></sitemap>… (nested sitemaps — surfaced as candidates)
  const sitemapindex = doc.sitemapindex as Record<string, unknown> | undefined;
  if (sitemapindex) {
    for (const s of asArray(sitemapindex.sitemap as unknown)) {
      const loc = (s as Record<string, unknown>)?.loc;
      if (typeof loc === "string" && loc.trim()) urls.push(loc.trim());
    }
  }
  // RSS 2.0: <rss><channel><item><link>…</link></item>…
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (channel) {
    for (const it of asArray(channel.item as unknown)) {
      const link = (it as Record<string, unknown>)?.link;
      if (typeof link === "string" && link.trim()) urls.push(link.trim());
    }
  }
  // Atom: <feed><entry><link href="…"/></entry>…
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    for (const e of asArray(feed.entry as unknown)) {
      const href = atomLinkHref((e as Record<string, unknown>)?.link);
      if (href && href.trim()) urls.push(href.trim());
    }
  }

  return [...new Set(urls)];
}

/** Build the generic JSON-LD adapter bound to the given SDK. */
export function createJsonLdAdapter(sdk: Sdk): SourceAdapter {
  return {
    id: sdk.source.id,

    async discover(sdkArg: Sdk): Promise<string[]> {
      const src = sdkArg.source;
      const discoveryUrl = src.sitemap_url ?? src.feed_url;
      if (!discoveryUrl) {
        sdkArg.log.warn("jsonld adapter: source has no sitemap_url or feed_url; nothing to discover", {
          source: src.id,
        });
        return [];
      }
      const { html, status } = await sdkArg.fetch(discoveryUrl);
      if (status >= 400) {
        sdkArg.log.warn("jsonld adapter: discovery fetch failed", { source: src.id, url: discoveryUrl, status });
        return [];
      }
      return extractUrlsFromXml(html);
    },

    extract(sdkArg: Sdk, url: string, html: string): RecipeItem | { error: string } {
      // The whole point of the generic adapter: reuse the shared parse, no custom scraping.
      return sdkArg.parsePageToRecipe(html, url);
    },
  };
}
