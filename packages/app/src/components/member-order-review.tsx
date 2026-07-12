import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { OrderReview, type OrderReviewHostAdapter } from "@yamp/ui";
import {
  BrandSaveReceiptSchema,
  CatalogSearchResultSchema,
  OrderReviewDataSchema,
  OrderReviewSendResultSchema,
  emptyOrderReviewStage,
  orderReviewContractSupport,
  type OrderReviewStage,
} from "@yamp/contract";
import { useOnline } from "../lib/online";
import { appFetch } from "../lib/api";

async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await appFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ message: response.statusText }))) as {
      message?: string;
    };
    throw new Error(error.message ?? `Request failed (${response.status})`);
  }
  return response.json();
}

export function MemberOrderReview({ onClose }: { onClose(): void }) {
  const online = useOnline();
  const queryClient = useQueryClient();
  const review = useQuery({
    queryKey: ["order-review", "fresh"],
    enabled: online,
    queryFn: async () =>
      OrderReviewDataSchema.parse(
        await postJson("/api/grocery/order/review", { stage: emptyOrderReviewStage() }),
      ),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const close = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["grocery"] });
    queryClient.removeQueries({ queryKey: ["order-review"] });
    onClose();
  }, [onClose, queryClient]);
  const adapter = React.useMemo<OrderReviewHostAdapter>(
    () => ({
      mode:
        review.data && orderReviewContractSupport(review.data.contract_version) === "supported"
          ? "interactive"
          : "readonly",
      online,
      preview: async (stage: OrderReviewStage) =>
        OrderReviewDataSchema.parse(await postJson("/api/grocery/order/review", { stage })),
      search: async (mode, line_key, preview_fingerprint, stage, query) =>
        CatalogSearchResultSchema.parse(
          await postJson("/api/grocery/order/search", {
            mode,
            line_key,
            preview_fingerprint,
            stage,
            ...(query ? { query } : {}),
          }),
        ),
      saveBrand: async (input) => {
        const receipt = BrandSaveReceiptSchema.parse(await postJson("/api/grocery/order/brand", input));
        await queryClient.invalidateQueries({ queryKey: ["profile"] });
        return receipt;
      },
      send: async (input) => {
        const outcome = OrderReviewSendResultSchema.parse(await postJson("/api/grocery/order", input));
        if (outcome.status === "sent") await queryClient.invalidateQueries({ queryKey: ["grocery"] });
        return outcome;
      },
      reauthorize: async () => {
        const response = await appFetch("/api/profile/kroger-login-url");
        if (!response.ok) throw new Error("Couldn't start Kroger reconnection.");
        const { url } = (await response.json()) as { url: string };
        window.location.assign(url);
      },
      closeToGrocery: close,
    }),
    [close, online, queryClient, review.data],
  );
  if (!online)
    return (
      <section id="grocery-order-review" data-testid="order-review-offline">
        <h2>Order review</h2>
        <p>Reconnect to review current Kroger availability and prices.</p>
        <button type="button" onClick={onClose}>
          Back to grocery
        </button>
      </section>
    );
  if (review.isPending)
    return (
      <section id="grocery-order-review">
        <h2>Order review</h2>
        <p>Resolving current Kroger choices…</p>
      </section>
    );
  if (!review.data)
    return (
      <section id="grocery-order-review">
        <h2>Order review</h2>
        <p role="alert">
          {review.error instanceof Error ? review.error.message : "Order review is unavailable."}
        </p>
        <button type="button" onClick={onClose}>
          Back to grocery
        </button>
      </section>
    );
  return <OrderReview data={review.data} adapter={adapter} />;
}
