// Tiny runtime-agnostic text helpers shared by the feed parser and the JSON-LD
// normalizer. No dependency, no DOM — pure string work that runs identically on
// workerd (the Worker) and in Node (the scraper + the project's test runtime).

/** Decode the common HTML/XML entities. `&amp;` is decoded last to avoid re-entrancy. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(n: number): string {
  try {
    return Number.isFinite(n) ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

/** Strip tags + CDATA, decode entities, collapse whitespace. For titles/summaries/steps. */
export function cleanText(raw: string): string {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s.replace(/\s+/g, " ").trim();
}

/** Truncate to `max` chars on a word boundary, appending an ellipsis when cut. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
