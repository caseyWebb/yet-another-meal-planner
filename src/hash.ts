// FNV-1a (32-bit) string hash → 8-char hex. NON-cryptographic: a change-detection key
// for derived-data reconciliation (recipe description + embedding), not a security
// primitive. A collision merely skips a regenerate until the next unrelated change,
// which self-heals — acceptable for a derived index. Deterministic and synchronous (no
// `crypto.subtle` await on the hot path), so the same input always maps to the same hash
// across ticks. Lives in its own module so both the reconcile (src/recipe-embeddings.ts)
// and the description generator (src/description.ts) import it without a cycle.
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // FNV prime 16777619, kept in 32-bit range via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
