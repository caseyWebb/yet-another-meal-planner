// Row-id minting for per-slot plan identity (meal-planning capability, D26-final).
// Pure and dependency-free (crypto.getRandomValues is workerd- and browser-native), so
// both the Worker and the member app mint the same shape. The canonical mint is a ULID
// (48-bit ms timestamp + 80 bits of crypto randomness, Crockford base32, 26 chars); the
// one-time migration minted 32-char lowercase hex ids in SQL. Both satisfy ROW_ID_RE,
// and because the formats mix, NO semantic ever parses or meaningfully sorts an id —
// ordering always uses `planned_for`/`meal`, with `id ASC` documented as an
// arbitrary-but-deterministic final tiebreak.

/** Crockford base32 (the ULID alphabet — no I, L, O, U). */
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The opaque row-id shape: ULIDs (26 chars) and the migration's 32-hex ids both match. */
export const ROW_ID_RE = /^[0-9A-Za-z_-]{10,40}$/;

/** True when `id` is a well-formed opaque row id (never parsed beyond this). */
export function isRowId(id: unknown): id is string {
  return typeof id === "string" && ROW_ID_RE.test(id);
}

/** Mint a ULID: 10 time chars (ms, big-endian) + 16 crypto-random chars. */
export function ulid(now: number = Date.now()): string {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ULID_ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(16));
  let out = time;
  for (let i = 0; i < 16; i++) out += ULID_ALPHABET[rand[i] & 31];
  return out;
}
