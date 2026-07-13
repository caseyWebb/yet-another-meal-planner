// One deterministic, secret-free projection for every member Store surface.
// Reads go through the existing profile/shared-corpus data layers; the only
// credential observation is refresh-token presence in KV.

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";
import { listStoreRows } from "./corpus-db.js";
import { createKrogerClient, KrogerError } from "./kroger.js";
import { disconnectKrogerUser, refreshKeyFor, type KvStore } from "./kroger-user.js";
import { readPreferences } from "./profile-db.js";
import type {
  KrogerLocation,
  OfflineStoreSummary,
  StoreAdapterProjection,
  StoreLauncherEntry,
} from "./store-adapter-shapes.js";
import { readAisleMap } from "./aisle-map.js";
import { getInstacartConfig } from "./instacart.js";

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function loadStoreAdapterProjection(env: Env, tenantId: string): Promise<StoreAdapterProjection> {
  const [preferences, refreshToken, rows] = await Promise.all([
    readPreferences(env, tenantId),
    (env.KROGER_KV as unknown as KvStore).get(refreshKeyFor(tenantId)),
    listStoreRows(env),
  ]);
  const storesPref =
    preferences?.stores && typeof preferences.stores === "object" && !Array.isArray(preferences.stores)
      ? (preferences.stores as Record<string, unknown>)
      : {};
  const primary = stringField(storesPref.primary);
  const fulfillment = stringField(storesPref.fulfillment);
  const preferredLocation = stringField(storesPref.preferred_location);
  const nicknameValues = storesPref.nicknames && typeof storesPref.nicknames === "object" && !Array.isArray(storesPref.nicknames)
    ? storesPref.nicknames as Record<string, unknown> : {};
  const preferred: KrogerLocation | null = preferredLocation
    ? {
        location_id: preferredLocation,
        name: stringField(storesPref.preferred_location_name) ?? preferredLocation,
        address: stringField(storesPref.preferred_location_address) ?? "",
        zip: stringField(storesPref.location_zip) ?? preferredLocation.match(/\b\d{5}\b/)?.[0] ?? "",
      }
    : null;

  const groceryRows = rows
    .filter((row) => row.domain === "grocery")
    .sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  const satelliteSelected = fulfillment === "satellite" && primary !== null;
  const offlineSelected = primary !== null && primary !== "kroger" && !satelliteSelected;
  const selectedRow = offlineSelected ? groceryRows.find((row) => row.slug === primary) ?? null : null;
  const offlineStores: OfflineStoreSummary[] = await Promise.all(groceryRows.map(async (row) => {
    const nickname = stringField(nicknameValues[row.slug]);
    const aisle_map = (await readAisleMap(env, row.slug, tenantId)).summary;
    return {
      slug: row.slug, name: row.name, shared_name: row.name, nickname,
      display_name: nickname ?? row.label ?? row.name, aisle_map,
      ...(row.label ? { label: row.label } : {}), ...(row.address ? { address: row.address } : {}),
      selected: row.slug === selectedRow?.slug,
    };
  }));
  const satelliteRow = satelliteSelected ? groceryRows.find((row) => row.slug === primary) ?? null : null;

  const launcher: StoreLauncherEntry[] = [];
  const instacartAvailable = getInstacartConfig(env) !== null;
  const linked = refreshToken !== null;
  if (primary === "kroger" || linked || preferred !== null) {
    launcher.push({
      id: "kroger",
      adapter: "kroger",
      mode: "online_order",
      store: preferred ? { slug: preferred.location_id, name: preferred.name } : null,
      enabled: linked && preferred !== null,
      disabled_reason: !linked ? "connect_kroger" : preferred === null ? "choose_kroger_store" : null,
    });
  }
  if (satelliteSelected && satelliteRow) {
    launcher.push({
      id: `satellite:${satelliteRow.slug}`,
      adapter: "satellite",
      mode: "satellite_cart_fill",
      store: { slug: satelliteRow.slug, name: satelliteRow.name },
      enabled: false,
      disabled_reason: "satellite_freshness_unavailable",
    });
  }
  if (selectedRow) {
    const projected = offlineStores.find((row) => row.slug === selectedRow.slug)!;
    launcher.push({
      id: `offline:${selectedRow.slug}`,
      adapter: "offline",
      mode: "store_walk",
      store: { slug: selectedRow.slug, name: projected.display_name, shared_name: selectedRow.name, domain: selectedRow.domain, aisle_map: projected.aisle_map },
      enabled: true,
      disabled_reason: null,
    });
  }
  if (instacartAvailable) {
    launcher.push({ id: "instacart", adapter: "instacart", mode: "marketplace_handoff", store: null, enabled: true, disabled_reason: null });
  }

  return {
    adapters: {
      kroger: { kind: "kroger", linked, preferred },
      instacart: { kind: "instacart", available: instacartAvailable },
      satellites: {
        kind: "satellites",
        state: "freshness_unavailable",
        stores: satelliteRow ? [{ slug: satelliteRow.slug, name: satelliteRow.name, session_fresh: null }] : [],
      },
      offline: {
        kind: "offline",
        stores: offlineStores,
        selected_slug: offlineSelected ? primary : null,
        selection_unavailable: offlineSelected && selectedRow === null,
      },
    },
    launcher,
  };
}

export async function searchKrogerLocations(env: Env, zip: string): Promise<{ locations: KrogerLocation[] }> {
  if (!/^\d{5}$/.test(zip)) {
    throw new ToolError("validation_failed", "zip must be exactly five digits");
  }
  try {
    return { locations: await createKrogerClient(env).locationsNearZip(zip, 10) };
  } catch (error) {
    const message = error instanceof KrogerError ? error.message : String(error);
    throw new ToolError("upstream_unavailable", message);
  }
}

export async function disconnectKrogerConnection(env: Env, tenantId: string): Promise<{ linked: false }> {
  await disconnectKrogerUser(env.KROGER_KV as unknown as KvStore, tenantId);
  return { linked: false };
}
