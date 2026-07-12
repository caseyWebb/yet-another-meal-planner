import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  EmptyState,
  GroceryList,
  PageHead,
  type GroceryAction,
  type GroceryHostAdapter,
} from "@yamp/ui";
import type { GroceryListData } from "@yamp/contract";
import {
  useGroceryAdd,
  useGroceryChecked,
  useGroceryCoverage,
  useGroceryRelist,
  useGroceryRemove,
  useGrocerySubstitution,
  usePantryVerify,
} from "../lib/mutations";
import { useGrocerySnapshot, useStoreAdapters, type StoreAdapterProjection } from "../lib/data";
import { useOnline } from "../lib/online";
import { api, apiError } from "../lib/api";
import { OrderPanel } from "../components/order-panel";

export const Route = createFileRoute("/_app/grocery")({ component: GroceryPage });

function GroceryPage() {
  const snapshot = useGrocerySnapshot();
  const adapters = useStoreAdapters();
  const online = useOnline();
  const qc = useQueryClient();
  const add = useGroceryAdd();
  const checked = useGroceryChecked();
  const coverage = useGroceryCoverage();
  const substitution = useGrocerySubstitution();
  const relist = useGroceryRelist();
  const remove = useGroceryRemove();
  const verify = usePantryVerify();
  const [orderOpen, setOrderOpen] = React.useState(false);

  const fresh = React.useCallback(async (): Promise<GroceryListData> => {
    const result = await snapshot.refetch();
    if (!result.data) throw new Error("The grocery snapshot is unavailable");
    return result.data;
  }, [snapshot.refetch]);

  const adapter = React.useMemo<GroceryHostAdapter>(
    () => ({
      mode: "interactive",
      online,
      mutate: async (action: GroceryAction) => {
        const current = snapshot.data;
        if (!current) throw new Error("The grocery snapshot is unavailable");
        switch (action.kind) {
          case "add":
            await add.mutateAsync({ name: action.name });
            return fresh();
          case "checked":
            return checked.mutateAsync({
              key: action.key,
              checked: action.checked,
              expected_row_version: action.expected_row_version,
              snapshot_version: action.snapshot_version,
            });
          case "remove": {
            const line = current.lines.find((item) => item.key === action.key);
            if (!line) return current;
            await remove.mutateAsync({ name: line.name });
            return fresh();
          }
          case "relist":
            return relist.mutateAsync({
              send_id: action.send_id,
              line_key: action.key,
              expected_row_version: action.expected_row_version,
            });
          case "mark_placed": {
            if (!online) throw new Error("Reconnect before confirming a purchase");
            const res = await api.api.grocery["mark-placed"].$post({
              json: {
                send_id: action.send_id,
                expected_line_keys: action.expected_line_keys,
                snapshot_version: action.snapshot_version,
              },
            });
            if (!res.ok) throw await apiError(res);
            return ((await res.json()) as { snapshot: GroceryListData }).snapshot;
          }
          case "pantry_verify":
            await verify.mutateAsync({ items: [action.key] });
            return fresh();
          case "pantry_buy_anyway":
            return coverage.mutateAsync({
              key: action.key,
              enabled: true,
              snapshot_version: action.snapshot_version,
            });
          case "pantry_undo":
            return coverage.mutateAsync({
              key: action.key,
              enabled: false,
              snapshot_version: action.snapshot_version,
            });
          case "substitute":
            return substitution.mutateAsync({
              original_key: action.original_key,
              replacement_key: action.replacement_key,
              replacement_name: action.replacement_name,
              snapshot_version: action.snapshot_version,
            });
          case "substitute_undo":
            return substitution.mutateAsync({
              original_key: action.original_key,
              snapshot_version: action.snapshot_version,
              undo: true,
            });
        }
      },
    }),
    [add, checked, coverage, fresh, online, relist, remove, snapshot.data, substitution, verify],
  );

  if (snapshot.isPending)
    return (
      <div data-testid="grocery-page">
        <PageHead title="Grocery list" sub="Loading your current list…" />
      </div>
    );
  if (!snapshot.data)
    return (
      <div data-testid="grocery-page">
        <PageHead title="Grocery list" />
        <EmptyState title="Couldn't load the list" sub="Try again when you're connected." />
      </div>
    );

  return (
    <div data-testid="grocery-page">
      <PageHead title="Grocery list" sub="Check off the store walk without changing online-cart state." />
      <StoreLauncher
        entries={adapters.data?.launcher ?? []}
        online={online}
        onOrder={() => setOrderOpen(true)}
      />
      {orderOpen ? (
        <OrderPanel inCartCount={snapshot.data.counts.in_carts} onClose={() => setOrderOpen(false)} />
      ) : null}
      <GroceryList
        data={snapshot.data}
        adapter={adapter}
        onDataChange={(data) => qc.setQueryData(["grocery", "view"], data)}
      />
    </div>
  );
}

function StoreLauncher({
  entries,
  online,
  onOrder,
}: {
  entries: StoreAdapterProjection["launcher"];
  online: boolean;
  onOrder(): void;
}) {
  const reason = (entry: StoreAdapterProjection["launcher"][number]) => {
    if (entry.disabled_reason === "connect_kroger") return "Connect Kroger in Profile first.";
    if (entry.disabled_reason === "choose_kroger_store") return "Choose a Kroger store in Profile first.";
    if (entry.disabled_reason === "satellite_freshness_unavailable")
      return "Reopen after the satellite reports.";
    return "This shopping path is not available yet.";
  };
  return (
    <section className="store-launcher" data-testid="store-launcher" aria-label="Shopping options">
      <div className="store-launcher-head">
        <strong>Shop this list</strong>
        <span>Manual shopping always remains available.</span>
      </div>
      {entries.length ? (
        <ul>
          {entries.map((entry) => {
            const actionable = entry.enabled && entry.mode === "online_order" && online;
            return (
              <li
                key={entry.id}
                data-testid="store-launcher-entry"
                data-launcher-id={entry.id}
                data-mode={entry.mode}
              >
                <span>
                  <strong>{entry.store?.name ?? "Store"}</strong>
                  <small>{entry.mode.replaceAll("_", " ")}</small>
                </span>
                <Button
                  size="sm"
                  variant={actionable ? "default" : "outline"}
                  data-testid={entry.mode === "online_order" ? "order-open" : undefined}
                  disabled={!actionable}
                  title={!online ? "Reconnect for store actions" : entry.enabled ? undefined : reason(entry)}
                  onClick={actionable ? onOrder : undefined}
                >
                  {entry.enabled ? "Open" : reason(entry)}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">Configure a store adapter in Profile, or shop manually below.</p>
      )}
    </section>
  );
}
