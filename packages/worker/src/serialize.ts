// Serialization helpers for the write path. Counterpart to parse.ts: turn structured
// data back into the repo's on-disk text. After d1-shared-corpus (slice 6) the only
// on-disk text the Worker writes is recipe markdown (everything else is D1), so this is
// just the markdown (YAML frontmatter + body) serializer.

import { dump as dumpYaml } from "js-yaml";

// NOTE: the former `stripEmptyVarietyDimensions` (which dropped a `none`/empty
// `protein`/`cuisine` to ABSENT before serialization) is retired. Under the
// required-field contract (src/recipe-contract.js) `protein`/`cuisine` are
// PRESENT-required, carrying an explicit `null` for "no protein focus" — never
// omitted, never the literal `"none"`. The write path persists the explicit `null`,
// and a `"none"` value is rejected by validateFile so the agent rewrites it as `null`.

/** Reassemble a markdown file from frontmatter + body (inverse of parseMarkdown). */
export function serializeMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  // dumpYaml ends with a trailing newline. Date handling is settled on both sides:
  // dumpYaml single-quotes a date-like STRING ("2026-06-09" → '2026-06-09') so it
  // reparses as a string, and parseMarkdown normalizes any Date value to a string
  // (see parse.ts normalizeDateValue) — so parse → serialize is a fixed point and
  // a `discovered_at: 2026-06-09` never drifts to a full ISO timestamp on rewrite.
  const yaml = dumpYaml(frontmatter, { lineWidth: -1 });
  return `---\n${yaml}---\n${body}`;
}
