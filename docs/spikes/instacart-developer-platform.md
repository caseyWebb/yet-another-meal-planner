# Instacart Developer Platform feasibility

Accessed 2026-07-12. This is the durable basis for yamp's Instacart scope.

- [API overview](https://docs.instacart.com/developer_platform_api/api/overview/): server
  requests authenticate with an operator API key in `Authorization: Bearer …` against
  `https://connect.dev.instacart.tools` or `https://connect.instacart.com`.
- [Create shopping list page](https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page):
  `POST /idp/v1/products/products_link` returns `products_link_url`; current line items
  use `line_item_measurements`, while top-level line-item `quantity` and `unit` are
  deprecated. Yamp requests a 30-day lifetime and caches an unchanged-content URL until
  expiry rather than creating pages repeatedly.
- [Shopping-list flow](https://docs.instacart.com/developer_platform_api/guide/concepts/shopping_list/):
  the landing page lets the member choose a retailer, review matches, add items, and
  continue checkout. The API call does not target or read a retailer/cart/order.
- [Nearby retailers](https://docs.instacart.com/developer_platform_api/api/retailers/get_nearby_retailers/):
  postal-code results are informational organizations and cannot target `products_link`.
  Yamp omits this call and stores no Instacart retailer preference.
- [CTA design](https://docs.instacart.com/developer_platform_api/guide/concepts/design/cta_design/)
  and [logos](https://docs.instacart.com/developer_platform_api/guide/concepts/design/logos/):
  approved copy/theme, 46px button, 29.5px radius, and 22px unmodified full-color logo.
- [Pre-launch checklist](https://docs.instacart.com/developer_platform_api/guide/concepts/launch_activities/pre-launch_checklist):
  production access is an external approval step requiring a compliant CTA demo and a
  test landing-page URL. Repository completion does not claim approval.

Consequently yamp implements an operator-authenticated Marketplace link handoff. It has
no member OAuth, callback, account link, retailer targeting, SKU resolution, prices,
availability, ETA, cart mutation/readback, checkout status, purchase assertion, grocery
lifecycle transition, or spend capture.
