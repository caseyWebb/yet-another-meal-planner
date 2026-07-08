// Ambient browser types for page.evaluate callbacks (this tsconfig deliberately has
// no DOM lib — the harness itself is Node; only these evaluate bodies run in the
// browser). Included ambiently via the tsconfig's `pages` include; just enough fetch
// surface for the session-authenticated raw writes.
interface BrowserFetchResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}
declare function fetch(
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<BrowserFetchResponse>;

// member-app-offline additions: just enough service-worker / storage / IDB surface
// for the offline, update, and purge specs' evaluate bodies.
declare const navigator: {
  onLine: boolean;
  serviceWorker: { ready: Promise<unknown>; controller: object | null };
};
declare const window: Record<string, unknown>;
declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
interface BrowserIDBRequest<T> {
  result: T;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}
interface BrowserIDBDatabase {
  objectStoreNames: { contains(name: string): boolean };
  transaction(
    store: string,
    mode: "readonly",
  ): { objectStore(name: string): { get(key: string): BrowserIDBRequest<unknown> } };
  close(): void;
}
declare const indexedDB: { open(name: string): BrowserIDBRequest<BrowserIDBDatabase> };

// cookbook.spec's searchbar assertions: computed styles (incl. pseudo-elements).
declare function getComputedStyle(
  el: unknown,
  pseudoElt?: string,
): { display: string; appearance: string };
