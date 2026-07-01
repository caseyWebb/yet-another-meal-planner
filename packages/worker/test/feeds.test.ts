import { describe, it, expect } from "vitest";
import { parseFeed } from "../src/feeds.js";

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
