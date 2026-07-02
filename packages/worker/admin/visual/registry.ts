// The all-areas registry: the ordered list of top-nav areas the smoke spec iterates (landmark +
// review screenshot per entry). Adding a new admin area = its page object + one entry here (+ a
// seed block when it needs data); the smoke coverage picks it up with no other spec edits.
// Sub-surfaces (member detail, satellites, the reconcile tab) are reached through their parent
// page objects and captured by dedicated smoke tests, not registry entries.
import type { AdminPage, Page } from "./pages/base.page";
import { StatusPage } from "./pages/status.page";
import { MembersPage } from "./pages/members.page";
import { DataPage } from "./pages/data.page";
import { InsightsPage } from "./pages/insights.page";
import { UsagePage } from "./pages/usage.page";
import { DiscoveryPage } from "./pages/discovery.page";
import { NormalizePage } from "./pages/normalize.page";
import { LogsPage } from "./pages/logs.page";
import { ConfigPage } from "./pages/config.page";

export interface RegisteredArea {
  /** The area/screenshot name (matches the page object's `area`). */
  readonly area: string;
  readonly make: (page: Page) => AdminPage;
}

export const AREAS: readonly RegisteredArea[] = [
  { area: "status", make: (p) => new StatusPage(p) },
  { area: "members", make: (p) => new MembersPage(p) },
  { area: "data", make: (p) => new DataPage(p) },
  { area: "insights", make: (p) => new InsightsPage(p) },
  { area: "usage", make: (p) => new UsagePage(p) },
  { area: "discovery", make: (p) => new DiscoveryPage(p) },
  { area: "normalize", make: (p) => new NormalizePage(p) },
  { area: "logs", make: (p) => new LogsPage(p) },
  { area: "config", make: (p) => new ConfigPage(p) },
];
