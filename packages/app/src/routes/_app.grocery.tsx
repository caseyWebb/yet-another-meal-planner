import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  GroceryList,
  GroceryWalk,
  PageHead,
  type GroceryAction,
  type GroceryHostAdapter,
} from "@yamp/ui";
import { groceryContractSupport, type GroceryListData } from "@yamp/contract";
import {
  useGroceryAdd,
  useGroceryChecked,
  useGroceryCoverage,
  useGroceryPantryVerify,
  useGroceryRelist,
  useGroceryRemove,
  useGrocerySubstitution,
  useShopCommit,
} from "../lib/mutations";
import { mintRowId, useGrocerySnapshot, useStoreAdapters, type StoreAdapterProjection } from "../lib/data";
import { useOnline } from "../lib/online";
import { api, apiError, appFetch } from "../lib/api";
import type { InstacartHandoffResult } from "@yamp/worker/instacart-shapes";
import { MemberOrderReview } from "../components/member-order-review";
import { readLocalWalk, readTenantStamp, writeLocalWalk, type LocalWalkSession } from "../lib/persist";
import type { ShopCommitRequest, ShopCommitResult, ShopReceipt } from "@yamp/contract";
import type { ApiError } from "../lib/api";

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
  const verify = useGroceryPantryVerify();
  const shopCommit = useShopCommit();
  const [walk, setWalk] = React.useState<LocalWalkSession | null>(() => readLocalWalk());
  const [receipt, setReceipt] = React.useState<ShopReceipt | null>(null);
  const [walkConflict, setWalkConflict] = React.useState<string | null>(null);
  const [shopError, setShopError] = React.useState<string | null>(null);
  const [manualDraft, setManualDraft] = React.useState<ShopCommitRequest | null>(null);
  const [orderOpen, setOrderOpen] = React.useState(false);
  const orderLauncherRef = React.useRef<HTMLButtonElement>(null);
  const closeOrder = React.useCallback(() => {
    setOrderOpen(false);
    requestAnimationFrame(() => orderLauncherRef.current?.focus());
  }, []);
  const contractSupported = groceryContractSupport(snapshot.data?.contract_version) === "supported";

  const setWalkUrl = React.useCallback((session: LocalWalkSession | null) => {
    const url = new URL(window.location.href);
    if (session?.state === "active" || session?.state === "pending_commit") {
      url.searchParams.set("mode", "walk"); url.searchParams.set("walk", session.session_id); url.searchParams.set("store", session.store_slug);
    } else { url.searchParams.delete("mode"); url.searchParams.delete("walk"); url.searchParams.delete("store"); }
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);
  const startWalk = React.useCallback((storeSlug: string) => {
    const current = readLocalWalk();
    const session: LocalWalkSession = current?.store_slug === storeSlug
      ? { ...current, state: "active" }
      : { session_id: mintRowId(), tenant_stamp: readTenantStamp() ?? "", store_slug: storeSlug, started_at: new Date().toISOString(), current_group: null, state: "active" };
    writeLocalWalk(session); setWalk(session); setReceipt(null); setWalkConflict(null); setWalkUrl(session);
  }, [setWalkUrl]);

  React.useEffect(() => {
    const seen = new WeakSet<object>();
    const adoptOutcome = (outcome: { status: "success"; result: Extract<ShopCommitResult, { outcome: "committed" | "replayed" }> } | { status: "error"; error: ApiError; vars: ShopCommitRequest }) => {
      if (outcome.status === "success") {
        setReceipt(outcome.result.receipt); setWalkConflict(null); setShopError(null); setWalkUrl(null); setManualDraft(null);
      } else if (outcome.vars.mode === "store_walk") {
        const current = readLocalWalk(); if (current?.session_id === outcome.vars.session_id) setWalk(current);
        setWalkConflict(outcome.error.message);
      } else setShopError(outcome.error.message);
    };
    const adopt = (mutation: { options: { mutationKey?: readonly unknown[] }; state: { status: string; data?: unknown; error?: unknown; variables?: unknown } }) => {
      if (mutation.options.mutationKey?.join("/") !== "grocery/shop-commit" || seen.has(mutation)) return;
      if (mutation.state.status !== "success" && mutation.state.status !== "error") return;
      seen.add(mutation);
      const vars = mutation.state.variables as ShopCommitRequest | undefined;
      if (!vars) return;
      if (mutation.state.status === "success") {
        const result = mutation.state.data as Extract<ShopCommitResult, { outcome: "committed" | "replayed" }>;
        adoptOutcome({ status: "success", result });
        qc.removeQueries({ queryKey: ["grocery", "shop-outcome", result.receipt.session_id], exact: true });
      } else {
        const error = mutation.state.error as ApiError;
        adoptOutcome({ status: "error", error, vars });
        qc.removeQueries({ queryKey: ["grocery", "shop-outcome", vars.session_id], exact: true });
      }
    };
    const cache = qc.getMutationCache();
    const outcomes = qc.getQueryCache().findAll({ queryKey: ["grocery", "shop-outcome"] }).sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
    if (outcomes[0]?.state.data) adoptOutcome(outcomes[0].state.data as Parameters<typeof adoptOutcome>[0]);
    for (const query of outcomes) qc.removeQueries({ queryKey: query.queryKey, exact: true });
    for (const mutation of cache.getAll()) adopt(mutation);
    return cache.subscribe((event) => { if (event.mutation) adopt(event.mutation); });
  }, [qc, setWalkUrl]);

  const fresh = React.useCallback(async (): Promise<GroceryListData> => {
    const result = await snapshot.refetch();
    if (!result.data) throw new Error("The grocery snapshot is unavailable");
    return result.data;
  }, [snapshot.refetch]);

  const adapter = React.useMemo<GroceryHostAdapter>(
    () => ({
      mode: contractSupported ? "interactive" : "readonly",
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
            return verify.mutateAsync({ key: action.key, snapshot_version: action.snapshot_version });
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
    [
      add,
      checked,
      contractSupported,
      coverage,
      fresh,
      online,
      relist,
      remove,
      snapshot.data,
      substitution,
      verify,
    ],
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

  const walkContext = snapshot.data.walk_context;
  if (walk && walkContext && walk.store_slug === walkContext.store_slug && (walk.state === "active" || walk.state === "pending_commit")) {
    return <div data-testid="grocery-page"><GroceryWalk
      data={snapshot.data} context={walkContext} online={online} pendingCommit={walk.state === "pending_commit" || shopCommit.isPending}
      receipt={receipt} conflict={walkConflict}
      onCheck={(line, value) => checked.mutate({ key: line.key, checked: value, expected_row_version: line.row_version, snapshot_version: snapshot.data.snapshot_version, occurred_at: new Date().toISOString() })}
      onPause={() => { const paused = { ...walk, state: "paused" as const }; writeLocalWalk(paused); setWalk(paused); setWalkUrl(null); }}
      onRetry={walk.commit && walkConflict && online && !shopCommit.isPending ? () => shopCommit.mutate(walk.commit!) : undefined}
      onFinish={(keys) => {
        const request = walk.commit ?? { session_id: walk.session_id, mode: "store_walk" as const, store_slug: walk.store_slug, expected_checked_keys: keys, snapshot_version: snapshot.data.snapshot_version, occurred_at: new Date().toISOString() };
        const pending = { ...walk, state: "pending_commit" as const, commit: request }; writeLocalWalk(pending); setWalk(pending);
        shopCommit.mutate(request);
      }}
    /></div>;
  }

  return (
    <div data-testid="grocery-page">
      <PageHead title="Grocery list" sub="Check off the store walk without changing online-cart state." />
      <StoreLauncher
        entries={adapters.data?.launcher ?? (snapshot.data.walk_context ? [{ id: `offline:${snapshot.data.walk_context.store_slug}`, adapter: "offline", mode: "store_walk", store: { slug: snapshot.data.walk_context.store_slug, name: snapshot.data.walk_context.display_name, shared_name: snapshot.data.walk_context.shared_name, domain: snapshot.data.walk_context.domain, aisle_map: snapshot.data.walk_context.aisle_map }, enabled: true, disabled_reason: null }] : [])}
        snapshotKey={JSON.stringify(snapshot.data)}
        underived={snapshot.data.underived}
        online={online}
        orderOpen={orderOpen}
        launcherRef={orderLauncherRef}
        onOrder={() => setOrderOpen((open) => !open)}
        onWalk={startWalk}
        onManual={() => setManualDraft({ session_id: mintRowId(), mode: "manual_shop", store_slug: null, expected_checked_keys: snapshot.data!.lines.filter((line) => line.checked_at != null && line.domain === "grocery").map((line) => line.key).sort(), snapshot_version: snapshot.data!.snapshot_version, occurred_at: new Date().toISOString() })}
        pausedWalk={walk?.state === "paused" ? walk : null}
      />
      {receipt ? <p role="status" data-testid="shop-receipt-summary">{receipt.mode === "manual_shop" ? "Manual shop logged" : "Store walk finished"} · {receipt.totals.items} items · ${receipt.totals.amount.toFixed(2)}</p> : null}
      {shopError ? <p role="alert">{shopError}</p> : null}
      <Dialog open={manualDraft !== null} onOpenChange={(open) => { if (!open) setManualDraft(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log this manual shop?</DialogTitle><DialogDescription>Checked grocery items will move into the pantry and spend history. This works without a store adapter.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setManualDraft(null)}>Cancel</Button><Button disabled={!manualDraft?.expected_checked_keys.length || shopCommit.isPending} onClick={() => { if (manualDraft) shopCommit.mutate(manualDraft); }}>{shopCommit.isPending ? "Logging…" : "Log shop"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {orderOpen ? (
        <MemberOrderReview onClose={closeOrder} />
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
  snapshotKey,
  underived,
  online,
  orderOpen,
  launcherRef,
  onOrder,
  onWalk,
  onManual,
  pausedWalk,
}: {
  entries: StoreAdapterProjection["launcher"];
  snapshotKey: string;
  underived: string[];
  online: boolean;
  orderOpen: boolean;
  launcherRef: React.RefObject<HTMLButtonElement | null>;
  onOrder(): void;
  onWalk(storeSlug: string): void;
  onManual(): void;
  pausedWalk: LocalWalkSession | null;
}) {
  const [instacartBusy, setInstacartBusy] = React.useState(false);
  const [instacartMessage, setInstacartMessage] = React.useState<string | null>(null);
  const [responseUnderived, setResponseUnderived] = React.useState<string[] | null>(null);
  const [confirmedUnderivedSignature, setConfirmedUnderivedSignature] = React.useState<string | null>(null);
  const instacartRequestRef = React.useRef<AbortController | null>(null);
  const instacartProjectionKey = (() => {
    const entry = entries.find((candidate) => candidate.mode === "marketplace_handoff");
    return entry ? `${entry.enabled}:${entry.disabled_reason ?? "ready"}` : "absent";
  })();
  const snapshotKeyRef = React.useRef(snapshotKey);
  const instacartProjectionKeyRef = React.useRef(instacartProjectionKey);
  snapshotKeyRef.current = snapshotKey;
  instacartProjectionKeyRef.current = instacartProjectionKey;
  const incompleteRecipes = [...new Set(responseUnderived ?? underived)].sort();
  const incompleteSignature = JSON.stringify(incompleteRecipes);
  React.useEffect(() => {
    instacartRequestRef.current?.abort();
    instacartRequestRef.current = null;
    setInstacartBusy(false);
    setInstacartMessage(null);
    setResponseUnderived(null);
    setConfirmedUnderivedSignature(null);
    return () => {
      instacartRequestRef.current?.abort();
      instacartRequestRef.current = null;
    };
  }, [snapshotKey, instacartProjectionKey]);
  const shopInstacart = async () => {
    const startingSnapshotKey = snapshotKey;
    const startingProjectionKey = instacartProjectionKey;
    const startingUnderivedSignature = incompleteSignature;
    const controller = new AbortController();
    instacartRequestRef.current?.abort();
    instacartRequestRef.current = controller;
    setInstacartBusy(true); setInstacartMessage(null);
    try {
      const response = await appFetch("/api/grocery/instacart", { method: "POST", signal: controller.signal });
      if (!response.ok) throw await apiError(response);
      const result = await response.json() as InstacartHandoffResult;
      if (controller.signal.aborted || snapshotKeyRef.current !== startingSnapshotKey || instacartProjectionKeyRef.current !== startingProjectionKey) return;
      if (result.status === "ready") {
        const authoritativeUnderived = [...new Set(result.underived)].sort();
        const authoritativeSignature = JSON.stringify(authoritativeUnderived);
        if (authoritativeSignature !== startingUnderivedSignature) {
          setResponseUnderived(authoritativeUnderived);
          setConfirmedUnderivedSignature(null);
          setInstacartMessage(authoritativeUnderived.length
            ? "The missing recipe details changed. Confirm the updated warning before creating an Instacart shopping page."
            : "Recipe completeness changed. Try creating the Instacart shopping page again.");
        } else if (authoritativeUnderived.length && confirmedUnderivedSignature !== authoritativeSignature) {
          setResponseUnderived(authoritativeUnderived);
          setConfirmedUnderivedSignature(null);
          setInstacartMessage("Some planned recipes still need ingredient details. Confirm the warning before creating an Instacart shopping page.");
        } else window.location.assign(result.url);
      } else if (result.status === "empty") {
        setInstacartMessage(result.underived.length ? "Nothing is ready to send yet; some planned recipes still need ingredient details." : "Your to-buy list is empty.");
      } else if (result.status === "unavailable") {
        setInstacartMessage("Instacart is not configured right now. Refresh or ask your operator.");
      } else {
        const messages = {
          invalid_request: "Instacart could not build this shopping page.", unauthorized: "The Instacart key is not authorized.",
          forbidden: "Instacart has not allowed this operation.", rate_limited: "Instacart is busy. Try again shortly.",
          upstream_unavailable: "Instacart is temporarily unavailable. Try again.", invalid_response: "Instacart returned an unusable shopping link.",
        } as const;
        setInstacartMessage(messages[result.code]);
      }
    } catch {
      if (!controller.signal.aborted && snapshotKeyRef.current === startingSnapshotKey && instacartProjectionKeyRef.current === startingProjectionKey) {
        setInstacartMessage("Could not reach Instacart. Reconnect and try again.");
      }
    } finally {
      if (instacartRequestRef.current === controller) {
        instacartRequestRef.current = null;
        setInstacartBusy(false);
      }
    }
  };
  const reason = (entry: StoreAdapterProjection["launcher"][number]) => {
    if (entry.disabled_reason === "connect_kroger") return "Connect Kroger in Profile first.";
    if (entry.disabled_reason === "choose_kroger_store") return "Choose a Kroger store in Profile first.";
    if (entry.disabled_reason === "satellite_freshness_unavailable")
      return "Reopen after the satellite reports.";
    if (entry.disabled_reason === "instacart_unavailable") return "Instacart is not configured.";
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
            const actionable = entry.enabled && (entry.mode === "store_walk" || (entry.mode === "online_order" && online));
            if (entry.mode === "marketplace_handoff") {
              const confirmationRequired = incompleteRecipes.length > 0 && confirmedUnderivedSignature !== incompleteSignature;
              return (
                <li key={entry.id} data-testid="store-launcher-entry" data-launcher-id="instacart" data-mode={entry.mode}>
                  <span>
                    <strong>Instacart Marketplace</strong>
                    <small>Choose a retailer, review matches, add items, and check out on Instacart.</small>
                    {incompleteRecipes.length ? (
                      <label className="instacart-preflight" data-testid="instacart-preflight">
                        <input
                          type="checkbox"
                          data-testid="instacart-incomplete-confirm"
                          checked={confirmedUnderivedSignature === incompleteSignature}
                          onChange={(event) => setConfirmedUnderivedSignature(event.currentTarget.checked ? incompleteSignature : null)}
                        />
                        I understand {incompleteRecipes.length} planned recipe{incompleteRecipes.length === 1 ? " is" : "s are"} missing ingredient details, so this Instacart page may be incomplete.
                      </label>
                    ) : null}
                  </span>
                  <button className="instacart-cta" data-testid="instacart-cta" disabled={!entry.enabled || !online || instacartBusy || confirmationRequired} aria-busy={instacartBusy} title={!entry.enabled ? reason(entry) : !online ? "Reconnect for store actions" : confirmationRequired ? "Confirm the incomplete recipe warning first." : undefined} onClick={entry.enabled && !confirmationRequired ? () => void shopInstacart() : undefined}>
                    <img src="/brands/instacart-carrot.svg" alt="" />
                    Shop on Instacart
                  </button>
                </li>
              );
            }
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
                  ref={entry.mode === "online_order" ? launcherRef : undefined}
                  aria-expanded={entry.mode === "online_order" ? orderOpen : undefined}
                  aria-controls={entry.mode === "online_order" ? "grocery-order-review" : undefined}
                  disabled={!actionable}
                  title={!online ? "Reconnect for store actions" : entry.enabled ? undefined : reason(entry)}
                  onClick={actionable ? entry.mode === "store_walk" && entry.store ? () => onWalk(entry.store!.slug) : onOrder : undefined}
                >
                  {entry.enabled ? entry.mode === "store_walk" ? pausedWalk?.store_slug === entry.store?.slug ? "Resume walk" : "Start walk" : entry.mode === "online_order" && orderOpen ? "Close" : "Open" : reason(entry)}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">Configure a store adapter in Profile, or shop manually below.</p>
      )}
      {instacartBusy || instacartMessage ? <p className="muted" role="status" data-testid="instacart-status">{instacartBusy ? "Creating an Instacart shopping page…" : instacartMessage}</p> : null}
      <Button variant="outline" onClick={onManual}>Log a manual shop</Button>
    </section>
  );
}
