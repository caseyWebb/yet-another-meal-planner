// Shell navigation: all nine area pills render and each routes to its area with the active
// state (real cross-document navigations — the panel has no client router).
import { test } from "../fixtures";
import { NAV_AREAS } from "../components/nav.component";

test("nav pills route across every area", async ({ statusPage }) => {
  await statusPage.goto();
  await statusPage.nav.expectRendered();
  for (const { label } of NAV_AREAS.slice(1)) {
    await statusPage.nav.goto(label);
    await statusPage.nav.expectActive(label);
    await statusPage.expectShell();
  }
});
