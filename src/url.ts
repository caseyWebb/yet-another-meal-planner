// Tiny URL helper, dependency-free so both discovery.ts and corpus-db.ts can use it
// without an import cycle (corpus-db's discovery-rejection filter and discovery's feed
// dedup both need the same canonical form).

/** Strip query + fragment + trailing slash so tracker-wrapped and bare links compare equal. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return raw.trim();
  }
}
