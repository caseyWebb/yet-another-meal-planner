import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import type { GroceryListData } from "@yamp/contract";
import { GroceryCard } from "./GroceryCard";
import "./styles.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  const root = createRoot(rootEl);
  const app = new App({ name: "grocery-list", version: "1.0.0" }, {}, { autoResize: true });
  const render = (data: GroceryListData | null) => root.render(<StrictMode>{data ? <GroceryCard app={app} data={data} /> : <p className="muted-line">Loading grocery list…</p>}</StrictMode>);
  render(null);
  app.ontoolresult = (params) => { const data = params.structuredContent as GroceryListData | undefined; if (data) render(data); };
  void app.connect();
}
