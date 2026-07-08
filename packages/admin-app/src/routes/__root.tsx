// The admin shell (operator-admin): the persistent title + area nav around every routed
// screen, plus the global chrome — the corner health indicator (every area, D6), the
// Access-expired overlay (D7), the theme toggle (D10), and the shared sparkline hover tip.
// Areas render client-side via the router; the active pill and the page width follow the
// current location (the SSR Layout's `active`/`wide` props, derived instead of passed).
import * as React from "react";
import { createRootRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { HealthIndicator, AccessExpiredOverlay, ThemeToggle } from "../components/shell";
import { useSparklineTips } from "../components/kit";

const AREAS = [
  { to: "/", label: "Status" },
  { to: "/members", label: "Members" },
  { to: "/data", label: "Data" },
  { to: "/insights", label: "Insights" },
  { to: "/usage", label: "Usage" },
  { to: "/discovery", label: "Discovery" },
  { to: "/normalize", label: "Normalization" },
  { to: "/logs", label: "Logs" },
  { to: "/config", label: "Config" },
] as const;

/** The areas that render the wide page shell (the SSR Layout's `wide` flag, by prefix). */
const WIDE_PREFIXES = ["/data", "/insights", "/usage", "/discovery", "/normalize", "/logs", "/config"];

function areaOf(pathname: string): (typeof AREAS)[number] {
  const hit = [...AREAS].reverse().find((a) => a.to !== "/" && pathname.startsWith(a.to));
  return hit ?? AREAS[0];
}

function RootLayout(): React.ReactElement {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const wide = WIDE_PREFIXES.some((p) => pathname.startsWith(p));
  useSparklineTips();

  React.useEffect(() => {
    document.title = `${areaOf(pathname).label} · grocery-agent admin`;
  }, [pathname]);

  return (
    <>
      <div className={wide ? "wrap wrap-wide" : "wrap"}>
        <h1>grocery-agent admin</h1>
        <nav className="nav">
          {AREAS.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="nav-link"
              activeProps={{ className: "nav-link active" }}
              activeOptions={{ exact: a.to === "/" }}
            >
              {a.label}
            </Link>
          ))}
        </nav>
        <Outlet />
      </div>
      <HealthIndicator />
      <ThemeToggle />
      <AccessExpiredOverlay />
    </>
  );
}

export const Route = createRootRoute({ component: RootLayout });
