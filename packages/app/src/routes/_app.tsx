// The session-gated app shell (member-app-core 7.1): fixed sidebar (nav + client-
// derived counts + account menu) and the scrolling content outlet — the design
// bundle's app frame (app-main.js renderFrame), ported. The loader's whoami is the
// boot check: a 401 redirects to /login; the resolved tenant feeds the account menu.
import * as React from "react";
import { Link, Outlet, createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import {
  IconBook,
  IconCalendar,
  IconCart,
  IconClock,
  IconHeart,
  IconMoon,
  IconPantry,
  IconSun,
  Toaster,
  Button,
} from "@grocery-agent/ui";
import { api } from "../lib/api";
import { useGrocery, useOverlay, usePlan, useProfile } from "../lib/data";
import { useOnline } from "../lib/online";

export const Route = createFileRoute("/_app")({
  loader: async () => {
    const res = await api.api.session.$get();
    if (res.status === 401) throw redirect({ to: "/login" });
    if (!res.ok) throw new Error(`whoami failed (${res.status})`);
    return res.json();
  },
  component: AppShell,
});

/** The theme toggle: `.dark` on <html>, remembered like the mock. */
export function applyTheme(mode: "light" | "dark") {
  document.documentElement.classList.toggle("dark", mode === "dark");
  try {
    localStorage.setItem("cookbook:theme", mode);
  } catch {
    // private-mode storage failures are fine — the toggle just won't persist
  }
}

export function initialTheme(): "light" | "dark" {
  try {
    return localStorage.getItem("cookbook:theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function ThemeFab({ size = "icon" }: { size?: "icon" | "icon-sm" }) {
  const [mode, setMode] = React.useState<"light" | "dark">(initialTheme);
  React.useEffect(() => applyTheme(mode), [mode]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`theme-fab${size === "icon-sm" ? " size-8" : ""}`}
      aria-label="Toggle dark mode"
      onClick={() => setMode(mode === "dark" ? "light" : "dark")}
    >
      {mode === "dark" ? <IconMoon /> : <IconSun />}
    </Button>
  );
}

const NAV = [
  { to: "/", label: "Cookbook", icon: IconBook, count: null },
  { to: "/favorites", label: "Favorites", icon: IconHeart, count: "favorites" },
  { to: "/plan", label: "Meal plan", icon: IconCalendar, count: "plan" },
  { to: "/grocery", label: "Grocery list", icon: IconCart, count: "grocery" },
  { to: "/pantry", label: "Pantry", icon: IconPantry, count: null },
  { to: "/log", label: "Cooking log", icon: IconClock, count: null },
] as const;

/** The shell's offline indicator (member-app-offline D10): driven by the SAME
 *  onlineManager that pauses/resumes the class (b) queue, so it can never disagree
 *  with replay behavior. Small chrome from existing tokens — flagged for a future
 *  Claude Design pass rather than inventing new design language here. */
function OfflinePill() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-md"
      role="status"
      data-testid="offline-pill"
    >
      Offline — changes sync when you're back
    </div>
  );
}

function AppShell() {
  const { tenant } = Route.useLoaderData();
  // Sidebar counts derive client-side from the already-cached area queries (design:
  // no counts endpoint) — the shell subscribing warms them for the pages too.
  const overlay = useOverlay();
  const plan = usePlan();
  const grocery = useGrocery();
  const counts: Record<string, number> = {
    favorites: Object.values(overlay.data?.overlay ?? {}).filter((r) => r.favorite).length,
    plan: plan.data?.planned.length ?? 0,
    grocery: grocery.data?.items.filter((g) => g.status !== "in_cart" && g.status !== "ordered").length ?? 0,
  };

  return (
    <div className="app-shell" data-testid="app-shell">
      <aside className="app-sidebar">
        <div className="sb-brand">
          <span className="brand-mark sm">
            <IconBook />
          </span>
          <span className="brand-name">Cookbook</span>
        </div>
        <nav className="sb-nav">
          {NAV.map((n) => {
            const c = n.count ? counts[n.count] : 0;
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                className="sb-link"
                to={n.to}
                activeOptions={{ exact: n.to === "/" }}
                activeProps={{ "data-active": true } as never}
              >
                <span className="sb-ico">
                  <Icon />
                </span>
                <span className="sb-label">{n.label}</span>
                {c > 0 ? <span className="sb-count">{c}</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="sb-foot">
          <AccountMenu tenant={tenant.id} />
          <ThemeFab size="icon-sm" />
        </div>
      </aside>
      <main className="app-content" id="app-content">
        <Outlet />
      </main>
      <OfflinePill />
      <Toaster />
    </div>
  );
}

function AccountMenu({ tenant }: { tenant: string }) {
  const [open, setOpen] = React.useState(false);
  const hostRef = React.useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const router = useRouter();
  const profile = useProfile();

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function logout() {
    await api.api.session.$delete();
    router.clearCache();
    void navigate({ to: "/login" });
  }

  const initial = tenant.charAt(0).toUpperCase();
  const krogerLinked = profile.data?.kroger.linked ?? false;
  return (
    <div className="sb-account" ref={hostRef}>
      <button
        type="button"
        className="sb-user"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="account-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sb-avatar">{initial}</span>
        <span className="sb-uname">@{tenant}</span>
        <svg className="sb-user-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="sb-menu" role="menu" data-testid="account-menu-panel">
          <div className="sb-menu-head">
            <span className="prof-avatar">{initial}</span>
            <div>
              <div className="prof-user">
                @{tenant}{" "}
                {krogerLinked ? (
                  <span className="badge-sm linked" data-testid="kroger-badge">
                    kroger
                  </span>
                ) : (
                  <span className="badge-sm" data-testid="kroger-badge">
                    kroger unlinked
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="sb-menu-sep" />
          <Link className="sb-menu-item" role="menuitem" to="/profile" onClick={() => setOpen(false)}>
            Profile &amp; preferences
          </Link>
          <button type="button" className="sb-menu-item" role="menuitem" data-testid="logout" onClick={logout}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

