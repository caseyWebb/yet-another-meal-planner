// The harness's extended `test`: one fixture per area page object, constructed on the spec's
// `page`. Specs import { test, expect } from here — never from @playwright/test directly and
// never constructing page objects inline — so route/selector knowledge stays in the objects.
import { test as base, expect } from "@playwright/test";
import { StatusPage } from "./pages/status.page";
import { MembersPage } from "./pages/members.page";
import { DataPage } from "./pages/data.page";
import { InsightsPage } from "./pages/insights.page";
import { UsagePage } from "./pages/usage.page";
import { DiscoveryPage } from "./pages/discovery.page";
import { NormalizePage } from "./pages/normalize.page";
import { LogsPage } from "./pages/logs.page";
import { ConfigPage } from "./pages/config.page";

interface AdminFixtures {
  statusPage: StatusPage;
  membersPage: MembersPage;
  dataPage: DataPage;
  insightsPage: InsightsPage;
  usagePage: UsagePage;
  discoveryPage: DiscoveryPage;
  normalizePage: NormalizePage;
  logsPage: LogsPage;
  configPage: ConfigPage;
}

export const test = base.extend<AdminFixtures>({
  statusPage: async ({ page }, use) => use(new StatusPage(page)),
  membersPage: async ({ page }, use) => use(new MembersPage(page)),
  dataPage: async ({ page }, use) => use(new DataPage(page)),
  insightsPage: async ({ page }, use) => use(new InsightsPage(page)),
  usagePage: async ({ page }, use) => use(new UsagePage(page)),
  discoveryPage: async ({ page }, use) => use(new DiscoveryPage(page)),
  normalizePage: async ({ page }, use) => use(new NormalizePage(page)),
  logsPage: async ({ page }, use) => use(new LogsPage(page)),
  configPage: async ({ page }, use) => use(new ConfigPage(page)),
});

export { expect };
