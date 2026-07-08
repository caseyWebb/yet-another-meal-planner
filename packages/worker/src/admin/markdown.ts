// Shared markdown-render helper (admin-ui-fidelity-pass, shared primitives). The Recipe-detail
// and Guidance views both render an R2 markdown object: a leading YAML frontmatter fence (parsed
// separately for the pretty-KV panel) followed by a body that should render clean — no stray
// leading whitespace/`<hr>` from an un-stripped fence. This reuses `parseMarkdown` (the same
// frontmatter-split `src/parse.ts` already performs for the recipe body, per the
// `operator-data-explorer` "Recipe body is provided frontmatter-stripped" requirement) so there
// is one splitter, not two.

import { marked } from "marked";
import { parseMarkdown } from "../parse.js";

export interface MarkdownDocument {
  /** Parsed YAML frontmatter, or `null` when the source had no leading `---` fence at all
   *  (a bare-body document — the caller can skip rendering a frontmatter panel). */
  frontmatter: Record<string, unknown> | null;
  /** The frontmatter-stripped body, rendered to HTML (see `renderMarkdown`). */
  html: string;
}

const FENCE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Render a markdown string to HTML with the panel's `.md` presentation in mind (see
 *  `styles.css`'s `.md` rules) — headings/lists/code get real spacing instead of the browser's
 *  default `<h1>`-sized headings and cramped list margins. `marked`'s defaults already emit
 *  semantic `<h2>`/`<ul>`/`<code>` etc.; the fidelity gap was in `.md`'s CSS, not the parse, so
 *  this stays a thin, explicit wrapper (one call site for every markdown render in the panel,
 *  and the place to add options like `gfm`/`breaks` if a future document needs them). */
export function renderMarkdown(src: string): string {
  return marked.parse(src, { async: false, gfm: true });
}

/**
 * Split a leading YAML frontmatter fence off `source` (reusing `parseMarkdown`) and render the
 * remaining body to HTML. `frontmatter` is `null` (not `{}`) when there was no fence at all, so
 * a caller can distinguish "no frontmatter to show" from "frontmatter parsed to an empty object" —
 * distinct legal states, not the same thing collapsed (admin/CLAUDE.md rule 6).
 */
export function parseMarkdownDocument(source: string, label = "document"): MarkdownDocument {
  const hadFence = FENCE.test(source);
  const { frontmatter, body } = parseMarkdown(source, label);
  return {
    frontmatter: hadFence ? frontmatter : null,
    html: renderMarkdown(body),
  };
}
