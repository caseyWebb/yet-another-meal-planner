import { QueryClient } from "@tanstack/react-query";
import type { GroceryLine, GroceryListData } from "@yamp/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerMutationDefaults,
  type GroceryCoverageVars,
  type GroceryPantryVerifyVars,
  type GroceryRelistVars,
  type GrocerySubstitutionVars,
} from "./mutations";

const line = (key: string, patch: Partial<GroceryLine> = {}): GroceryLine => ({
  key,
  name: key,
  quantity: 1,
  kind: "grocery",
  domain: "grocery",
  origin: "list",
  checked_at: null,
  row_version: 1,
  updated_at: null,
  for_recipes: [],
  ...patch,
});

const snapshot = (version: string, patch: Partial<GroceryListData> = {}): GroceryListData => ({
  contract_version: 1,
  snapshot_version: version,
  as_of: "2026-07-12T12:00:00Z",
  lines: [line("milk"), line("eggs")],
  to_buy: ["milk", "eggs"],
  pantry_covered: [],
  substitution_decisions: [],
  coverage_decisions: [],
  in_cart_groups: [],
  underived: [],
  location: null,
  flyer_as_of: null,
  counts: { to_buy: 2, checked: 0, in_carts: 0, recipes: 0 },
  ...patch,
});

type Defaults<V> = {
  mutationFn(vars: V): Promise<GroceryListData>;
  onMutate(vars: V): unknown;
  onSuccess(data: GroceryListData): unknown;
  onError(error: unknown): unknown;
};

function defaults<V>(qc: QueryClient, key: string[]): Defaults<V> {
  return qc.getMutationDefaults(key) as unknown as Defaults<V>;
}

function client(initial: GroceryListData): QueryClient {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  qc.setQueryData(["grocery", "view"], initial);
  registerMutationDefaults(qc);
  return qc;
}

afterEach(() => vi.unstubAllGlobals());

describe("persisted grocery mutation defaults", () => {
  it("keeps substitution accept and Undo truthful in the persisted optimistic cache", () => {
    const qc = client(snapshot("v1", { lines: [line("milk")], to_buy: ["milk"] }));
    const mutation = defaults<GrocerySubstitutionVars>(qc, ["grocery", "substitution"]);
    mutation.onMutate({
      original_key: "milk",
      replacement_key: "oat-milk",
      replacement_name: "Oat milk",
      snapshot_version: "v1",
    });
    expect(qc.getQueryData<GroceryListData>(["grocery", "view"])).toMatchObject({
      lines: [{ key: "oat-milk" }],
      to_buy: ["oat-milk"],
      substitution_decisions: [{ original_key: "milk", replacement_key: "oat-milk" }],
    });

    const persisted = JSON.parse(
      JSON.stringify(qc.getQueryData<GroceryListData>(["grocery", "view"])),
    ) as GroceryListData;
    const restored = client(persisted);
    defaults<GrocerySubstitutionVars>(restored, ["grocery", "substitution"]).onMutate({
      original_key: "milk",
      snapshot_version: "v1",
      undo: true,
    });
    expect(restored.getQueryData<GroceryListData>(["grocery", "view"])).toMatchObject({
      lines: [{ key: "milk" }],
      to_buy: ["milk"],
      substitution_decisions: [],
    });
  });

  it("rebases serial replay requests onto the preceding authoritative snapshot", async () => {
    const qc = client(snapshot("v1"));
    const sent: Record<string, unknown>[] = [];
    const responses = [snapshot("v2"), snapshot("v3")];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ snapshot: responses.shift() }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const coverage = defaults<GroceryCoverageVars>(qc, ["grocery", "coverage"]);
    const substitution = defaults<GrocerySubstitutionVars>(qc, ["grocery", "substitution"]);
    const first = await coverage.mutationFn({
      key: "milk",
      enabled: true,
      snapshot_version: "v1",
    });
    coverage.onSuccess(first);
    await substitution.mutationFn({
      original_key: "eggs",
      replacement_key: "flax-eggs",
      replacement_name: "Flax eggs",
      snapshot_version: "v1",
    });
    expect(sent.map((body) => body.snapshot_version)).toEqual(["v1", "v2"]);
  });

  it.each([
    ["coverage", { key: "milk", enabled: true, snapshot_version: "v1" }],
    [
      "substitution",
      {
        original_key: "milk",
        replacement_key: "oat-milk",
        replacement_name: "Oat milk",
        snapshot_version: "v1",
      },
    ],
  ] as const)("installs the authoritative conflict snapshot for restored %s defaults", (key, vars) => {
    const optimistic = snapshot("v1", { lines: [line("milk")], to_buy: ["milk"] });
    const restored = client(JSON.parse(JSON.stringify(optimistic)) as GroceryListData);
    const mutation = defaults<typeof vars>(restored, ["grocery", key]);
    mutation.onMutate(vars);
    const authoritative = snapshot("v2", {
      lines: [line("server-only", { row_version: 4 })],
      to_buy: ["server-only"],
    });
    mutation.onError({
      error: "conflict",
      message: "Grocery state changed",
      context: { snapshot: authoritative },
    });
    expect(restored.getQueryData(["grocery", "view"])).toEqual(authoritative);
  });

  it("uses the exact grocery pantry verification route and projects only its key", async () => {
    const initial = snapshot("v1", {
      lines: [],
      to_buy: [],
      pantry_covered: [
        {
          key: "milk",
          name: "Milk",
          for_recipes: [],
          freshness: "worth_a_look",
          on_hand: { last_verified_at: "2026-06-01" },
          buy_anyway: false,
        },
      ],
    });
    const qc = client(initial);
    let request = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        request = String(input);
        return new Response(JSON.stringify({ snapshot: snapshot("v2") }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const mutation = defaults<GroceryPantryVerifyVars>(qc, ["grocery", "pantry-verify"]);
    mutation.onMutate({ key: "milk", snapshot_version: "v1" });
    expect(
      qc.getQueryData<GroceryListData>(["grocery", "view"])?.pantry_covered[0]?.on_hand.last_verified_at,
    ).toBe("2026-07-12");
    await mutation.mutationFn({ key: "milk", snapshot_version: "v1" });
    expect(request).toContain("/api/grocery/pantry-verify");
  });

  it("removes a relisted send group when its final line leaves", () => {
    const qc = client(
      snapshot("v1", {
        in_cart_groups: [
          {
            send_id: "send-1",
            store: "Kroger",
            location_id: "1",
            fulfillment: "kroger_online",
            sent_at: "2026-07-12T12:00:00Z",
            placed_at: null,
            awaiting_confirmation: false,
            estimated_total: 4,
            flyer_savings: null,
            can_mark_placed: true,
            lines: [{ key: "bread", name: "Bread", quantity: 1, row_version: 2, unit_price: 4, savings: null }],
          },
        ],
        counts: { to_buy: 2, checked: 0, in_carts: 1, recipes: 0 },
      }),
    );
    defaults<GroceryRelistVars>(qc, ["grocery", "relist"]).onMutate({
      send_id: "send-1",
      line_key: "bread",
      expected_row_version: 2,
    });
    expect(qc.getQueryData<GroceryListData>(["grocery", "view"])?.in_cart_groups).toEqual([]);
  });
});
