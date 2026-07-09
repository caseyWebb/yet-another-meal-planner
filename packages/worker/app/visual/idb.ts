// IndexedDB condition-poll helpers (member-app-offline D11): the offline and purge
// specs assert on the PERSISTED client — read through raw indexedDB in the page
// (idb-keyval's default store: DB "keyval-store", object store "keyval", one
// "yamp-query-cache" key) — with Playwright's polling assertions, never fixed
// sleeps. The persister throttles writes (~1 s), so specs poll until the snapshot
// contains what they need before cutting the network.
import { expect, type Page } from "@playwright/test";

interface PersistedSnapshot {
  present: boolean;
  buster?: string;
  queryKeys: unknown[][];
  pausedMutationKeys: unknown[][];
}

/** One raw read of the persisted client (undefined-safe on a missing DB/store/key). */
export async function persistedSnapshot(page: Page): Promise<PersistedSnapshot> {
  return page.evaluate(async () => {
    const value = await new Promise<unknown>((resolve) => {
      const open = indexedDB.open("keyval-store");
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("keyval")) {
          db.close();
          resolve(undefined);
          return;
        }
        const req = db.transaction("keyval", "readonly").objectStore("keyval").get("yamp-query-cache");
        req.onsuccess = () => {
          db.close();
          resolve(req.result);
        };
        req.onerror = () => {
          db.close();
          resolve(undefined);
        };
      };
    });
    const client = value as
      | { buster?: string; clientState?: { queries?: { queryKey: unknown[] }[]; mutations?: { mutationKey?: unknown[] }[] } }
      | undefined;
    if (!client?.clientState) return { present: false, queryKeys: [], pausedMutationKeys: [] };
    return {
      present: true,
      buster: client.buster,
      queryKeys: (client.clientState.queries ?? []).map((q) => q.queryKey),
      pausedMutationKeys: (client.clientState.mutations ?? []).map((m) => m.mutationKey ?? []),
    };
  });
}

/** Poll until the persisted client contains a query under `prefix`. */
export async function waitForPersistedQuery(page: Page, prefix: string): Promise<void> {
  await expect
    .poll(async () => (await persistedSnapshot(page)).queryKeys.map((k) => String(k[0])), {
      message: `persisted client never contained a ["${prefix}",…] query`,
    })
    .toContain(prefix);
}

/** The row names inside the persisted ["grocery"] query's data (empty when absent) —
 *  lets the offline spec wait until SPECIFIC rows are at rest, not just the prefix
 *  (a stale-but-present snapshot must never satisfy the pre-offline gate). */
export async function persistedGroceryNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const value = await new Promise<unknown>((resolve) => {
      const open = indexedDB.open("keyval-store");
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("keyval")) {
          db.close();
          resolve(undefined);
          return;
        }
        const req = db.transaction("keyval", "readonly").objectStore("keyval").get("yamp-query-cache");
        req.onsuccess = () => {
          db.close();
          resolve(req.result);
        };
        req.onerror = () => {
          db.close();
          resolve(undefined);
        };
      };
    });
    const client = value as
      | { clientState?: { queries?: { queryKey: unknown[]; state: { data?: unknown } }[] } }
      | undefined;
    const grocery = client?.clientState?.queries?.find(
      (q) => q.queryKey.length === 1 && q.queryKey[0] === "grocery",
    );
    const data = grocery?.state.data as { items?: { name: string }[] } | undefined;
    return (data?.items ?? []).map((i) => i.name);
  });
}

/** Poll until the persisted client contains at least `count` paused mutations. */
export async function waitForPersistedMutations(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await persistedSnapshot(page)).pausedMutationKeys.length, {
      message: `persisted client never reached ${count} queued mutation(s)`,
    })
    .toBeGreaterThanOrEqual(count);
}

/**
 * Assert no member data is at rest (the D9 purge's guarantee). The purge deletes the
 * IDB key, but the still-running persister lawfully re-writes an EMPTY snapshot when
 * `queryClient.clear()`'s cache events flush through its throttle — both "key absent"
 * and "present but zero queries/mutations" are the purged state, and both are stable
 * (nothing member-scoped can re-enter the cache on the login screen).
 */
export async function expectNoPersistedMemberData(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const snap = await persistedSnapshot(page);
      return !snap.present || (snap.queryKeys.length === 0 && snap.pausedMutationKeys.length === 0);
    })
    .toBe(true);
}
