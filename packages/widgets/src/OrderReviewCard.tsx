import type { App } from "@modelcontextprotocol/ext-apps";
import type { OrderReviewData } from "@yamp/contract";
import { createOrderReviewBridgeAdapter, OrderReview, orderReviewFromBridge, resolveOrderReviewCapabilities, type OrderReviewBridge } from "@yamp/ui";
import * as React from "react";

export function OrderReviewCard({ app, data }: { app: App; data: OrderReviewData }) {
  const [initial] = React.useState(data);
  const [current, setCurrent] = React.useState(initial);
  const [hydrated, setHydrated] = React.useState(false);
  const [bootFailed, setBootFailed] = React.useState(false);
  const bridge = React.useState(() => app as unknown as OrderReviewBridge)[0];
  const host = React.useState(() => app.getHostCapabilities())[0];
  const base = resolveOrderReviewCapabilities({ contractVersion: initial.contract_version, serverTools: host?.serverTools != null, updateModelContext: host?.updateModelContext != null, message: host?.message != null, hydrated: false });
  React.useEffect(() => {
    if (!base.contractSupported || host?.serverTools == null || host?.updateModelContext == null) return;
    let cancelled = false;
    void bridge.callServerTool({ name: "read_order_review", arguments: { stage: { skipped: [], quantities: {}, selections: [], impulses: [], saved_brands: [] } } }).then((result) => {
      const review = orderReviewFromBridge(result); if (!cancelled && review) { setCurrent(review); setHydrated(true); } else if (!cancelled) setBootFailed(true);
    }).catch(() => { if (!cancelled) setBootFailed(true); });
    return () => { cancelled = true; };
  }, [base.contractSupported, bridge, host?.serverTools, host?.updateModelContext]);
  const capabilities = resolveOrderReviewCapabilities({ contractVersion: current.contract_version, serverTools: host?.serverTools != null, updateModelContext: host?.updateModelContext != null, message: host?.message != null, hydrated: hydrated && !bootFailed });
  const adapter = React.useMemo(() => createOrderReviewBridgeAdapter(bridge, capabilities), [bridge, capabilities.mode, capabilities.contractSupported]);
  return <div data-widget="order-review" data-hydrated={hydrated || undefined}>{bootFailed ? <p role="status">Showing the saved review read-only; current facts could not be refreshed.</p> : null}<OrderReview data={current} adapter={adapter} onDataChange={setCurrent} /></div>;
}
