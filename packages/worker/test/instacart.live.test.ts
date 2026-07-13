import { describe, expect, it } from "vitest";
import { createInstacartClient, getInstacartConfig, buildInstacartPayload } from "../src/instacart.js";
import type { ToBuyView } from "../src/order-shapes.js";

describe.skipIf(process.env.INSTACART_LIVE !== "1" || !process.env.INSTACART_API_KEY)("Instacart development smoke", () => {
  it("returns only a valid Marketplace URL", async () => {
    const config = getInstacartConfig({ INSTACART_API_KEY: process.env.INSTACART_API_KEY, INSTACART_API_ENV: "development" })!;
    const view = { to_buy: [{ key: "banana", name: "banana", quantity: 1, assumed_quantity: false, for_recipes: [], origin: "list", kind: "grocery", domain: "grocery", checked_at: null, row_version: 1, updated_at: null }], checked: [], pantry_covered: [], in_cart: [], underived: [] } as ToBuyView;
    const result = await createInstacartClient(config).create(buildInstacartPayload(view));
    expect(result.ok).toBe(true);
    if (result.ok) expect(new URL(result.url).hostname.endsWith("instacart.com")).toBe(true);
  });
});
