// The P5 airplane-mode acceptance (member-app-offline D11), driven FOR REAL: the built
// SPA under its real service worker against the seeded local Worker — browser-context
// offline emulation, real IndexedDB persistence, and replayed writes observed
// server-side through the browser's own fetch (the P1 cookie finding). The SW is
// ALLOWED and `/api` is never `page.route`d (interception cannot see SW-mediated
// traffic — the quirk this suite structurally avoids); every wait is a condition poll
// (serviceWorker readiness, persisted-state contents, the server-visible replay),
// never a fixed sleep. The spec provisions its own rows and removes them, leaving the
// seeded grocery state for the later specs.
import { test, expect } from "../fixtures";
import { persistedGroceryNames, persistedSnapshot, waitForPersistedMutations, waitForPersistedQuery } from "../idb";
import { becomeControlled } from "../sw";

const ITEM_A = "offline croissants";
const ITEM_B = "offline batteries";
const ITEM_SHOP = "offline receipt oranges";

test("airplane mode opens the grocery list from the persisted cache; offline check-offs replay on reconnect — including across an offline reload", async ({
  asMember,
  groceryPage,
  shellPage,
  page,
  context,
}) => {
  await asMember();
  await groceryPage.addRow(ITEM_A);
  await groceryPage.addRow(ITEM_B);
  await groceryPage.goto();
  await groceryPage.landmark();
  await becomeControlled(page);
  await groceryPage.landmark();

  // The persister throttles (~1 s): poll until the grocery reads are AT REST before
  // cutting the network — this is the state an offline launch restores from. The
  // gate is CONTENT-aware: the snapshot must carry this spec's provisioned rows,
  // not merely some earlier grocery read.
  await waitForPersistedQuery(page, "grocery");
  await expect.poll(() => persistedGroceryNames(page)).toContain(ITEM_A);
  await expect.poll(() => persistedGroceryNames(page)).toContain(ITEM_B);

  // ── Acceptance leg 1: airplane-mode launch renders shell + list, zero network. ──
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await groceryPage.landmark(); // the SW served the shell; the loader fell back to the stamp
  await expect(shellPage.offlinePill()).toBeVisible();
  await expect(groceryPage.item(ITEM_A)).toBeVisible(); // rendered from IndexedDB
  await groceryPage.captureForReview("grocery-offline");

  // ── Leg 2: an offline check is optimistic + queued, and replays on reconnect. ──
  await groceryPage.toggleChecked(ITEM_A);
  await expect(groceryPage.item(ITEM_A)).toHaveAttribute("data-checked", "true");
  expect(await page.evaluate(() => navigator.onLine)).toBe(false); // still offline: nothing hit the server
  await context.setOffline(false);
  // The paused mutation resumes; checking never changes cart lifecycle status.
  await expect.poll(() => groceryPage.rowChecked(ITEM_A)).toBe(true);
  expect(await groceryPage.rowStatus(ITEM_A)).toBe("active");
  await expect(shellPage.offlinePill()).toHaveCount(0); // the indicator clears on reconnect

  // ── Leg 3: a queued write SURVIVES an offline reload and replays after restore. ──
  await context.setOffline(true);
  await groceryPage.toggleChecked(ITEM_B);
  await expect(groceryPage.item(ITEM_B)).toHaveAttribute("data-checked", "true");
  // Poll until the paused mutation itself is AT REST (same throttle as the queries).
  await waitForPersistedMutations(page, 1);
  await page.reload({ waitUntil: "domcontentloaded" }); // still offline: shell from precache…
  await groceryPage.landmark();
  await expect(groceryPage.item(ITEM_B)).toHaveAttribute("data-checked", "true"); // …optimistic state restored with the snapshot
  await context.setOffline(false);
  // resume-after-restore re-binds the persisted variables to the registered default
  // and replays; the server-visible row converges.
  await expect.poll(() => groceryPage.rowChecked(ITEM_B)).toBe(true);

  // Leave the seeded state for the later specs (sequential suite).
  await groceryPage.removeRow(ITEM_A);
  await groceryPage.removeRow(ITEM_B);
});

test("adapter truth and class-(a) store actions never persist, queue, or auto-fire on reconnect", async ({
  asMember,
  groceryPage,
  profilePage,
  page,
  context,
}) => {
  await asMember();
  await groceryPage.goto();
  await becomeControlled(page);
  await waitForPersistedQuery(page, "grocery");
  await expect.poll(async () => (await persistedSnapshot(page)).queryKeys.some((key) => key[0] === "store-adapters")).toBe(false);

  await profilePage.goto();
  await profilePage.openTab("prefs");
  await profilePage.openStoreTab("offline");
  const choice = profilePage.offlineStore("aldi-north").getByRole("button", { name: "Use this store" });
  await expect(choice).toBeEnabled();
  await context.setOffline(true);
  await expect(choice).toBeDisabled();
  await profilePage.openStoreTab("kroger");
  await expect(profilePage.storePanel("kroger").getByRole("button", { name: "Disconnect" })).toBeDisabled();
  expect((await persistedSnapshot(page)).pausedMutationKeys).toEqual([]);

  let adapterActions = 0;
  page.on("request", (request) => {
    if (/kroger-(connection|locations|login-url)/.test(request.url())) adapterActions++;
  });
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  expect(adapterActions).toBe(0);
  expect((await persistedSnapshot(page)).pausedMutationKeys).toEqual([]);
});

test("offline store-walk Finish survives reload and adopts its receipt after ordered replay away from Grocery", async ({ asMember, groceryPage, page, context }) => {
  await asMember();
  const previousStores = await page.evaluate(async () => {
    const body = await (await fetch("/api/profile/preferences")).json() as { preferences?: { stores?: Record<string, unknown> }; stores?: Record<string, unknown> };
    return body.preferences?.stores ?? body.stores ?? {};
  });
  await groceryPage.setStores({ primary: "aldi-north", fulfillment: null });
  const previouslyChecked = await page.evaluate(async () => {
    let current = await (await fetch("/api/grocery/view")).json() as { snapshot_version: string; lines: Array<{ key: string; checked_at: string | null; row_version: number }> };
    const keys = current.lines.filter((line) => line.checked_at != null).map((line) => line.key);
    for (const line of current.lines.filter((row) => row.checked_at != null)) {
      const res = await fetch("/api/grocery/checked", { method: "POST", headers: { "content-type": "application/json", "X-App-Csrf": "1" }, body: JSON.stringify({ key: line.key, checked: false, expected_row_version: line.row_version, snapshot_version: current.snapshot_version }) });
      current = ((await res.json()) as { snapshot: typeof current }).snapshot;
    }
    return keys;
  });
  await groceryPage.addRow(ITEM_SHOP);
  await groceryPage.goto(); await groceryPage.landmark(); await becomeControlled(page); await groceryPage.landmark();
  await groceryPage.startWalk("offline:aldi-north");
  await waitForPersistedQuery(page, "grocery");
  await expect.poll(() => persistedGroceryNames(page)).toContain(ITEM_SHOP);
  await context.setOffline(true);
  const shopCheck = groceryPage.walk().getByRole("checkbox", { name: ITEM_SHOP });
  await shopCheck.click(); await expect(shopCheck).toBeChecked();
  await groceryPage.finishWalk(); await groceryPage.confirmFinish();
  await waitForPersistedMutations(page, 2);
  await page.reload({ waitUntil: "domcontentloaded" }); await groceryPage.landmark();
  await expect(groceryPage.walk()).toContainText("Finishing when online");
  await page.goto("/profile", { waitUntil: "domcontentloaded" });
  await context.setOffline(false);
  await expect.poll(() => groceryPage.rowStatus(ITEM_SHOP), { timeout: 20_000 }).toBeUndefined();
  await groceryPage.goto(); await groceryPage.landmark();
  await expect(page.getByTestId("shop-receipt-summary")).toContainText("Store walk finished");
  await page.evaluate(async ({ item, restore }) => {
    await fetch("/api/pantry/ops", { method: "POST", headers: { "content-type": "application/json", "X-App-Csrf": "1" }, body: JSON.stringify({ operations: [{ op: "remove", name: item }] }) });
    for (const key of restore) {
      const current = await (await fetch("/api/grocery/view")).json() as { snapshot_version: string; lines: Array<{ key: string; row_version: number }> };
      const line = current.lines.find((row) => row.key === key);
      if (line) await fetch("/api/grocery/checked", { method: "POST", headers: { "content-type": "application/json", "X-App-Csrf": "1" }, body: JSON.stringify({ key, checked: true, expected_row_version: line.row_version, snapshot_version: current.snapshot_version }) });
    }
  }, { item: ITEM_SHOP, restore: previouslyChecked });
  await groceryPage.setStores(previousStores);
});
