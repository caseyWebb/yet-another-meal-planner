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

// --- Outbound-fetch egress guard (outbound-fetch-safety) ---------------------------------
// The same guard every server-side fetch of an externally-influenced URL runs before
// connecting (src/http.ts), AND the write-time check the feed writers apply (src/corpus-db.ts).
// Pure string/URL parsing so it lives here, dependency-free, and is unit-testable in isolation.
//
// LIMIT (documented, accepted): on workerd there is no DNS module, so a Worker cannot resolve a
// hostname to an IP before fetch() does. This guard is therefore LITERAL-only — it blocks
// IP-literal and localhost-name private targets, not a public name that resolves to a private
// address. The deployment has no co-located metadata/loopback service, which is why that residual
// is acceptable (issues #53/#67 are medium/low for exactly this reason).

/** Why a URL is refused for server-side fetch. */
export type UnsafeUrlReason = "malformed" | "scheme" | "userinfo" | "private_host";

/** Thrown by `assertPublicHttpUrl` when a URL is not safe to fetch server-side. */
export class UnsafeUrlError extends Error {
  constructor(readonly reason: UnsafeUrlReason, message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** True for an IPv4 literal in a loopback / private / link-local / unspecified range (or one
 *  that is syntactically a dotted-quad but out of range — refused conservatively). */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false; // not a dotted-quad — caller handles as a name
  const o = parts.map((p) => Number(p));
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // malformed quad → refuse
  const [a, b] = o;
  return (
    a === 0 || // 0.0.0.0/8 (this-network / unspecified)
    a === 127 || // 127.0.0.0/8 loopback
    a === 10 || // 10.0.0.0/8 private
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) // 192.168.0.0/16 private
  );
}

/** Expand an IPv6 literal (brackets stripped) to its 16 bytes, or null when unparseable.
 *  Handles `::` compression and an embedded IPv4 tail (`::ffff:127.0.0.1`). */
function expandIpv6(addr: string): number[] | null {
  let a = addr.toLowerCase().trim();
  if (a === "") return null;
  // Fold an embedded dotted-quad tail into two hextets so the rest is pure hex.
  const v4 = a.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4 && v4.index !== undefined) {
    const q = v4[1].split(".").map(Number);
    if (q.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    a = a.slice(0, v4.index) + `${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
  let groups: string[];
  if (tail === null) {
    groups = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  }
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = Number.parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

/** True for an IPv6 literal (brackets already stripped) that is loopback / unspecified /
 *  unique-local (fc00::/7) / link-local (fe80::/10), or an IPv4-mapped private address. An
 *  unparseable literal is refused (returns true). */
function isPrivateIpv6(addr: string): boolean {
  const b = expandIpv6(addr);
  if (!b) return true; // unparseable → refuse conservatively
  if (b.every((x) => x === 0)) return true; // :: unspecified
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true; // ::1 loopback
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    return isPrivateIpv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`); // ::ffff:a.b.c.d
  }
  return false;
}

/** True when a URL host is a private/loopback/link-local literal or a localhost name. A normal
 *  public hostname returns false (it cannot be resolved here — see the module LIMIT note). */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.startsWith("[") && host.endsWith("]")) return isPrivateIpv6(host.slice(1, -1));
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host);
  return false;
}

/** Validate a URL is safe to fetch server-side and return the parsed URL: `http`/`https` only,
 *  no userinfo, and a non-private host. Throws `UnsafeUrlError` otherwise. */
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("malformed", `Not a valid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UnsafeUrlError("scheme", `Unsupported scheme: ${u.protocol}`);
  }
  if (u.username !== "" || u.password !== "") {
    throw new UnsafeUrlError("userinfo", "URL must not contain embedded credentials");
  }
  if (isPrivateHost(u.hostname)) {
    throw new UnsafeUrlError("private_host", `Refusing to fetch a private/loopback host: ${u.hostname}`);
  }
  return u;
}

/** Boolean form of `assertPublicHttpUrl` for the write-time feed-URL guard. */
export function isPublicHttpUrl(raw: string): boolean {
  try {
    assertPublicHttpUrl(raw);
    return true;
  } catch {
    return false;
  }
}
