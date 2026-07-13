// Workerd-pure member wire shapes for the shared store-adapter projection. This
// leaf is imported by both the Worker operation and the browser app; it carries
// no environment bindings, database code, or credentials.

export type StoreAdapterKind = "kroger" | "instacart" | "satellites" | "offline";
export type StoreLauncherAdapter = "kroger" | "instacart" | "satellite" | "offline";
export type StoreLauncherMode = "online_order" | "marketplace_handoff" | "satellite_cart_fill" | "store_walk";
export type StoreLauncherDisabledReason =
  | "connect_kroger"
  | "choose_kroger_store"
  | "satellite_freshness_unavailable"
  | "instacart_unavailable"
  | "store_walk_unavailable"
  | null;

export interface KrogerLocation {
  location_id: string;
  name: string;
  address: string;
  zip: string;
}

export interface KrogerStoreAdapter {
  kind: "kroger";
  linked: boolean;
  preferred: KrogerLocation | null;
}

export interface InstacartStoreAdapter {
  kind: "instacart";
  available: boolean;
}

export interface SatelliteStoreSummary {
  slug: string;
  name: string;
  session_fresh: null;
}

export interface SatellitesStoreAdapter {
  kind: "satellites";
  state: "freshness_unavailable";
  stores: SatelliteStoreSummary[];
}

export interface OfflineStoreSummary {
  slug: string;
  name: string;
  shared_name: string;
  nickname: string | null;
  display_name: string;
  aisle_map: import("@yamp/contract").AisleMapSummary;
  label?: string;
  address?: string;
  selected: boolean;
}

export interface OfflineStoreAdapter {
  kind: "offline";
  stores: OfflineStoreSummary[];
  selected_slug: string | null;
  selection_unavailable: boolean;
}

export interface StoreLauncherEntry {
  id: string;
  adapter: StoreLauncherAdapter;
  mode: StoreLauncherMode;
  store: { slug: string; name: string; shared_name?: string; domain?: string; aisle_map?: import("@yamp/contract").AisleMapSummary } | null;
  enabled: boolean;
  disabled_reason: StoreLauncherDisabledReason;
}

export interface StoreAdapterProjection {
  adapters: {
    kroger: KrogerStoreAdapter;
    instacart: InstacartStoreAdapter;
    satellites: SatellitesStoreAdapter;
    offline: OfflineStoreAdapter;
  };
  launcher: StoreLauncherEntry[];
}
