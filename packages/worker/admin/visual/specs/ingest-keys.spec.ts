// Config › Ingest Keys interactions (satellite-pull-channel): the roster's tenant-binding column
// (a seeded operator-global key + a seeded tenant-bound key) and the mint dialog's bind-to-tenant
// selector (default operator-global, options = the allowlisted members).
import { test, expect } from "../fixtures";
import { SEED } from "../seed.mjs";

test("roster shows both an operator-global and a tenant-bound key binding", async ({ configPage }) => {
  await configPage.gotoIngestKeys();
  // The unbound key renders the muted "operator-global"; the bound key renders its member id.
  await configPage.expectIngestKeyBinding(SEED.ingestKeys.global.label, "operator-global");
  await configPage.expectIngestKeyBinding(SEED.ingestKeys.bound.label, SEED.ingestKeys.bound.tenant);
  await configPage.captureForReview("config-ingest-keys");
});

test("mint dialog offers a tenant-binding selector defaulting to operator-global", async ({ configPage }) => {
  await configPage.gotoIngestKeys();
  const dialog = await configPage.openMintKeyDialog();
  await expect(dialog.title("Mint ingest key")).toBeVisible();

  const select = configPage.tenantBindingSelect;
  await expect(select).toBeVisible();
  // Default selection is operator-global (the empty-value option).
  await expect(select).toHaveValue("");
  // The allowlisted members are offered as bind targets.
  await expect(select.locator("option", { hasText: SEED.members.active })).toHaveCount(1);
  await expect(select.locator("option", { hasText: SEED.members.pending })).toHaveCount(1);
  await configPage.captureForReview("config-ingest-keys-mint");
});
