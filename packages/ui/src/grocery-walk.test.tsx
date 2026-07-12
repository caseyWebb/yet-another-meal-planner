import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GroceryListData, OfflineWalkContext } from "@yamp/contract";
import { projectGroceryWalk } from "./grocery-controller";
import { GroceryWalk } from "./components/grocery-walk";

const data: GroceryListData = {
  contract_version: 2, snapshot_version: "sha256:test", as_of: "2026-07-12T12:00:00Z",
  lines: [
    { key: "apples", name: "Apples", quantity: "2", kind: "grocery", domain: "grocery", origin: "list", checked_at: "2026-07-12T11:00:00Z", row_version: 2, updated_at: null, for_recipes: [] },
    { key: "milk", name: "Milk", quantity: "1", kind: "grocery", domain: "grocery", origin: "list", checked_at: null, row_version: 1, updated_at: null, for_recipes: [] },
  ],
  to_buy: ["milk"], pantry_covered: [], in_cart_groups: [], underived: [], location: null, flyer_as_of: null,
  counts: { to_buy: 1, checked: 1, in_carts: 0, recipes: 0 },
};
const context: OfflineWalkContext = {
  store_slug: "market", shared_name: "Market", display_name: "The close store", domain: "grocery",
  aisle_map: { state: "stale", aisle_count: 2, as_of: "2025-01-01" }, observed_at: "2025-01-01",
  groups: [
    { id: "aisle:1", label: "Aisle 1", placement_source: "section_map", line_keys: ["apples"], warning: "stale_map" },
    { id: "cold-last", label: "Grab last", placement_source: "cold_last", line_keys: ["milk"], warning: null },
  ],
};

describe("GroceryWalk", () => {
  it("projects completed/current groups from checked truth without local checked state", () => {
    expect(projectGroceryWalk(data, context)).toMatchObject({ total: 2, checked: 1, current_group: "cold-last", groups: [{ complete: true }, { complete: false }] });
  });

  it("renders the approved progress, stale warning, quiet offline note, and hides normal panels", () => {
    const html = renderToStaticMarkup(<GroceryWalk data={data} context={context} online={false} pendingCommit={false} receipt={null} conflict={null} onCheck={() => {}} onPause={() => {}} onFinish={() => {}} />);
    expect(html).toContain("The close store");
    expect(html).toContain("1 of 2 picked");
    expect(html).toContain("Grab last");
    expect(html).toContain("Offline — changes will sync");
    expect(html).toContain("Map may be out of date");
    expect(html).not.toContain("Pantry covers");
    expect(html).not.toContain("Add an item");
  });
});
