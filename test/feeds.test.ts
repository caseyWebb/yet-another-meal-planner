import { describe, it, expect } from "vitest";
import { parseFeed, addFeeds } from "../src/feeds.js";
import { parseToml } from "../src/parse.js";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  <item>
    <title><![CDATA[Chicken & Rice]]></title>
    <link>https://ex.com/chicken-rice/</link>
    <description><![CDATA[<p>Yum &amp; easy</p>]]></description>
  </item>
  <item>
    <title>Linkless</title>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Pasta e Fagioli</title>
    <link href="https://ex.com/feed" rel="self"/>
    <link href="https://ex.com/pasta-e-fagioli" rel="alternate"/>
    <summary>A bean and pasta soup.</summary>
  </entry>
</feed>`;

describe("parseFeed (RSS 2.0)", () => {
  const items = parseFeed(RSS);

  it("drops items without a link", () => {
    expect(items).toHaveLength(1);
  });

  it("decodes CDATA + entities in title and strips HTML from summary", () => {
    expect(items[0].title).toBe("Chicken & Rice");
    expect(items[0].link).toBe("https://ex.com/chicken-rice/");
    expect(items[0].summary).toBe("Yum & easy");
  });
});

describe("parseFeed (Atom)", () => {
  const items = parseFeed(ATOM);

  it("prefers the rel=alternate link over rel=self", () => {
    expect(items).toHaveLength(1);
    expect(items[0].link).toBe("https://ex.com/pasta-e-fagioli");
    expect(items[0].title).toBe("Pasta e Fagioli");
    expect(items[0].summary).toBe("A bean and pasta soup.");
  });
});

describe("parseFeed (malformed)", () => {
  it("returns [] for non-feed input rather than throwing", () => {
    expect(parseFeed("not xml at all")).toEqual([]);
    expect(parseFeed("<html><body>nope</body></html>")).toEqual([]);
  });
});

function feeds(text: string): Record<string, unknown>[] {
  const parsed = parseToml(text, "feeds.toml");
  return Array.isArray(parsed.feeds) ? (parsed.feeds as Record<string, unknown>[]) : [];
}

describe("addFeeds", () => {
  it("adds feeds to an empty file with a default weight and preserves the header", () => {
    const { text, added } = addFeeds(null, [
      { url: "https://www.seriouseats.com/recipes/atom.xml", name: "Serious Eats", weight: 0.8 },
      { url: "https://www.budgetbytes.com/feed/" }, // weight defaults to 1
    ]);
    expect(added).toBe(2);
    expect(text.startsWith("# feeds.toml")).toBe(true);
    const rows = feeds(text);
    expect(rows.map((f) => f.url)).toContain("https://www.budgetbytes.com/feed/");
    expect(rows.find((f) => f.name === "Serious Eats")?.weight).toBe(0.8);
    expect(rows.find((f) => f.url === "https://www.budgetbytes.com/feed/")?.weight).toBe(1);
  });

  it("dedups by canonicalized url (query/trailing-slash-insensitive), existing untouched", () => {
    const first = addFeeds(null, [{ url: "https://ex.com/feed", name: "Ex", weight: 0.5 }]);
    const second = addFeeds(first.text, [
      { url: "https://ex.com/feed/?utm_source=x" }, // same after canonicalization → ignored
      { url: "https://other.com/rss" },
    ]);
    expect(second.added).toBe(1);
    const rows = feeds(second.text);
    expect(rows).toHaveLength(2);
    expect(rows.find((f) => f.name === "Ex")?.weight).toBe(0.5); // original kept
  });

  it("reports nothing added when every url is a duplicate", () => {
    const first = addFeeds(null, [{ url: "https://ex.com/feed" }]);
    const noop = addFeeds(first.text, [{ url: "https://ex.com/feed" }]);
    expect(noop.added).toBe(0);
  });

  it("ignores feeds with a blank url", () => {
    const { added } = addFeeds(null, [{ url: "   " }]);
    expect(added).toBe(0);
  });
});
