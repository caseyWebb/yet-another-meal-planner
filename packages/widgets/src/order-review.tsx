import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import { OrderReviewDataSchema, type OrderReviewData } from "@yamp/contract";
import { OrderReviewCard } from "./OrderReviewCard";
import "./styles.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  const root = createRoot(rootEl);
  const app = new App({ name: "order-review", version: "1.0.0" }, {}, { autoResize: true });
  const render = (data: OrderReviewData | null) => root.render(<StrictMode>{data ? <OrderReviewCard app={app} data={data} /> : <p>Loading order review…</p>}</StrictMode>);
  render(null);
  app.ontoolresult = (params) => { const parsed = OrderReviewDataSchema.safeParse(params.structuredContent); if (parsed.success) render(parsed.data); };
  void app.connect();
}
