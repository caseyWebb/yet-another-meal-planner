// A small in-memory R2 bucket fake for the corpus store + reconcile tests. Stores
// object bodies as strings keyed by path and implements the subset of the R2Bucket
// surface src/corpus-store.ts uses: get / put / delete / list (with prefix + "/"
// delimiter so listDir's one-level semantics are exercised). Enough fidelity to test
// the store's read/list/write contract and the reconcile's whole-corpus read without a
// live R2.

export interface FakeR2 {
  bucket: R2Bucket;
  objects: Map<string, string>;
}

export function fakeR2(init: Record<string, string> = {}): FakeR2 {
  const objects = new Map<string, string>(Object.entries(init));

  const bucket = {
    async get(key: string): Promise<R2ObjectBody | null> {
      if (!objects.has(key)) return null;
      const text = objects.get(key)!;
      return { key, text: async () => text } as unknown as R2ObjectBody;
    },
    async put(key: string, value: unknown): Promise<R2Object> {
      const text =
        typeof value === "string"
          ? value
          : value instanceof ArrayBuffer
            ? new TextDecoder().decode(value)
            : String(value);
      objects.set(key, text);
      return { key } as unknown as R2Object;
    },
    async delete(keys: string | string[]): Promise<void> {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
    async list(opts?: R2ListOptions): Promise<R2Objects> {
      const prefix = opts?.prefix ?? "";
      const delimiter = opts?.delimiter ?? undefined;
      const objs: { key: string }[] = [];
      const prefixes = new Set<string>();
      for (const key of [...objects.keys()].sort()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (delimiter && rest.includes(delimiter)) {
          const idx = rest.indexOf(delimiter);
          prefixes.add(prefix + rest.slice(0, idx + delimiter.length));
        } else {
          objs.push({ key });
        }
      }
      return {
        objects: objs,
        delimitedPrefixes: [...prefixes],
        truncated: false,
      } as unknown as R2Objects;
    },
  } as unknown as R2Bucket;

  return { bucket, objects };
}
