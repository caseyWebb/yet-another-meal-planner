// RSS/Atom feed parsing via fast-xml-parser (a real XML parser — pure JS, runs
// on workerd and in Node, so it's unit-testable). Handles RSS 2.0 (`<item>`,
// `<link>URL</link>`), Atom (`<entry>`, `<link href rel>`), and RSS 1.0
// (`rdf:RDF`). Entity/CDATA decoding is the parser's job; we strip any inline
// HTML left in a description down to a plain summary. Faithful extraction only —
// bounding/truncation is the caller's.

import { XMLParser } from "fast-xml-parser";
import { cleanText } from "./text.js";

export interface FeedItem {
  title: string;
  link: string;
  summary: string | null;
}

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

type XmlNode = Record<string, unknown>;

/** A node's text: a bare string/number, or its `#text` when it carried attributes. */
function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object") {
    const t = (v as XmlNode)["#text"];
    if (typeof t === "string") return t;
    if (typeof t === "number") return String(t);
  }
  return "";
}

/** RSS `<link>URL</link>` or an Atom `<link href>` (preferring rel alternate/absent). */
function extractLink(entry: XmlNode): string | null {
  const l = entry.link;
  if (typeof l === "string" && /^https?:/i.test(l)) return l;

  const arr = Array.isArray(l) ? l : l != null ? [l] : [];
  let fallback: string | null = null;
  for (const item of arr) {
    if (typeof item === "string") {
      if (/^https?:/i.test(item)) return item;
      continue;
    }
    const node = item as XmlNode;
    const href = node["@_href"];
    if (typeof href !== "string") {
      const text = textOf(node);
      if (/^https?:/i.test(text) && !fallback) fallback = text;
      continue;
    }
    const rel = node["@_rel"];
    if (rel == null || rel === "alternate") return href;
    if (!fallback) fallback = href;
  }
  return fallback;
}

/** Locate the item/entry list across RSS 2.0, Atom, and RSS 1.0 document shapes. */
function collectEntries(doc: XmlNode): XmlNode[] {
  const rss = doc.rss as XmlNode | undefined;
  const channel = rss?.channel as XmlNode | undefined;
  const feed = doc.feed as XmlNode | undefined;
  const rdf = doc["rdf:RDF"] as XmlNode | undefined;

  const raw = channel?.item ?? feed?.entry ?? rdf?.item;
  if (raw == null) return [];
  return (Array.isArray(raw) ? raw : [raw]) as XmlNode[];
}

/** Parse an RSS 2.0 / Atom / RSS 1.0 feed into items. Items without a link are dropped. */
export function parseFeed(xml: string): FeedItem[] {
  let doc: XmlNode;
  try {
    doc = PARSER.parse(xml) as XmlNode;
  } catch {
    return [];
  }

  const items: FeedItem[] = [];
  for (const entry of collectEntries(doc)) {
    const link = extractLink(entry);
    if (!link) continue;
    const summaryRaw =
      textOf(entry.description) || textOf(entry.summary) || textOf(entry["content:encoded"]);
    items.push({
      title: cleanText(textOf(entry.title)),
      link: link.trim(),
      summary: summaryRaw ? cleanText(summaryRaw) : null,
    });
  }
  return items;
}
