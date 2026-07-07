// Minimal markdown → HTML for recipe bodies and the profile prose fields — the
// design bundle's mdToHtml (paragraphs, bullet lists, **bold**, *italic*) extended
// with the two shapes recipe bodies add: `##`/`###` headings and numbered lists.
// Input is HTML-escaped FIRST, so authored corpus content can never inject markup.

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const inline = (s: string) =>
  s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

/** Render markdown to safe HTML (escape-first). Empty input → an empty string. */
export function mdToHtml(src: string | null | undefined): string {
  const blocks = String(src ?? "")
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean);
  return blocks
    .map((b) => {
      const lines = b.split("\n");
      const heading = /^(#{1,4})\s+(.*)$/.exec(lines[0]);
      if (heading && lines.length === 1) {
        const level = Math.min(Math.max(heading[1].length, 2), 4);
        return `<h${level}>${inline(esc(heading[2]))}</h${level}>`;
      }
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(esc(l.replace(/^\s*[-*]\s+/, "")))}</li>`).join("")}</ul>`;
      }
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        return `<ol>${lines.map((l) => `<li>${inline(esc(l.replace(/^\s*\d+[.)]\s+/, "")))}</li>`).join("")}</ol>`;
      }
      // A block that STARTS with a heading then continues renders both parts.
      if (heading) {
        const level = Math.min(Math.max(heading[1].length, 2), 4);
        const rest = lines.slice(1).join("\n");
        return `<h${level}>${inline(esc(heading[2]))}</h${level}><p>${inline(esc(rest)).replace(/\n/g, "<br>")}</p>`;
      }
      return `<p>${inline(esc(b)).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}
