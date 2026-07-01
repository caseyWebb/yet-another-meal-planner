// schema.org Recipe extraction + normalization (design D5).
//
// Two layers:
//   1. extractJsonLd(res) — pull <script type="application/ld+json"> blocks out of
//      the HTML with HTMLRewriter (the idiomatic Cloudflare tool; workerd-only, so
//      it's exercised by the live smoke test, not Node unit tests). Thin + mechanical.
//      This layer stays HERE (workerd-specific).
//   2. findRecipe / normalizeRecipe — PURE functions over already-parsed JSON-LD.
//      All the real complexity (instruction shapes, durations, yield) lives in the
//      runtime-agnostic @grocery-agent/contract package (shared with the scraper),
//      re-exported below so existing `./jsonld.js` importers are unchanged.

export {
  findRecipe,
  normalizeRecipe,
  flattenInstructions,
  parseDurationMinutes,
  normalizeYield,
  type NormalizedRecipe,
  type NormalizeResult,
} from "@grocery-agent/contract";

// --- layer 1: HTML → parsed JSON-LD blocks (workerd, via HTMLRewriter) -------

function tryParseJson(raw: string): unknown {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // A few sites HTML-encode quotes inside the script; try a minimal decode.
    try {
      return JSON.parse(text.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, "&"));
    } catch {
      return undefined;
    }
  }
}

/**
 * Collect and parse every JSON-LD script block from an HTML Response. Script
 * content is raw text bounded by `</script>`, so HTMLRewriter's text chunks are
 * accumulated per element and parsed at its end tag. Unparseable blocks are skipped.
 */
export async function extractJsonLd(res: Response): Promise<unknown[]> {
  const blocks: unknown[] = [];
  let buf = "";
  const rewriter = new HTMLRewriter().on('script[type="application/ld+json"]', {
    element(el) {
      buf = "";
      el.onEndTag(() => {
        const parsed = tryParseJson(buf);
        if (parsed !== undefined) blocks.push(parsed);
        buf = "";
      });
    },
    text(chunk) {
      buf += chunk.text;
    },
  });
  // Consuming the transformed body drives the handlers to completion.
  await rewriter.transform(res).text();
  return blocks;
}
