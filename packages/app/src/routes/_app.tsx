// The session-gated app shell (member-app-core 7.1): fixed sidebar (nav + client-
// derived counts + account menu) and the scrolling content outlet — the design
// bundle's app frame (app-main.js renderFrame), ported. The loader's whoami is the
// boot check, disambiguated per member-app-offline D3: a definitive 401 purges local
// member data and redirects to /login; a NETWORK failure (offline) falls back to the
// locally stamped identity and renders the shell over the persisted cache — the stamp
// is a boot/display hint only, never an authority (every online request still rides
// the cookie session).
import * as React from "react";
import { Link, Outlet, createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import {
  IconBook,
  IconCalendar,
  IconCart,
  IconClock,
  IconMoon,
  IconPantry,
  IconSparkle,
  IconSun,
  IconUsers,
  Button,
  toast,
} from "@yamp/ui";
import { api } from "../lib/api";
import { ConnectClaudeModal, type OperatorInfo } from "../components/connect-claude";
import { enrollPasskey } from "../lib/passkey";
import { useProfile, useSidebarCounts } from "../lib/data";
import { useOnline } from "../lib/online";
import { promptInstall, useInstallAvailable } from "../lib/install";
import { purgeLocalMemberData, readTenantStamp, writeTenantStamp } from "../lib/persist";

export const Route = createFileRoute("/_app")({
  loader: async (): Promise<{
    /** The resolved identity pair from whoami. `member` is the acting member id
     *  (attribution — the own/community notes split keys on it); it equals `id` for
     *  founding members and degrades to `id` offline / under deploy skew. */
    tenant: { id: string; member: string };
    /** The deployment profile from whoami — gates the SaaS-only surfaces (cookbook
     *  cold-start, the Preferences curated-collection card). Offline/skew degrades to
     *  "self-hosted": the gated surfaces simply don't render. */
    profile: "self-hosted" | "saas";
    operator: OperatorInfo;
  }> => {
    const res = await api.api.session.$get().catch(() => null);
    if (res === null) {
      // No server reachable (offline / network error): render the shell for the
      // stamped member over the persisted cache; with no stamp, present login
      // (the SW serves it offline). NEVER purge here — an offline device keeps
      // its own member's data (D9). The operator config isn't stamped: the
      // connect modal degrades to generic copy offline.
      const stamped = readTenantStamp();
      if (stamped)
        return { tenant: { id: stamped, member: stamped }, profile: "self-hosted", operator: { name: null, repo: null } };
      throw redirect({ to: "/login" });
    }
    if (res.status === 401) {
      // A definitive rejection (revocation/expiry) must not leave member data at
      // rest — the stamp never overrides the server's no.
      await purgeLocalMemberData();
      throw redirect({ to: "/login" });
    }
    if (!res.ok) throw new Error(`whoami failed (${res.status})`);
    const data = (await res.json()) as {
      tenant: { id: string; member?: string };
      profile?: "self-hosted" | "saas";
      operator: OperatorInfo;
    };
    writeTenantStamp(data.tenant.id);
    // Defensive: a pre-change Worker (deploy skew) omits `operator`/`profile` — degrade
    // to generic copy / the self-hosted default rather than throwing or over-gating.
    // `member` falls back to the tenant id (exact for founding members).
    return {
      tenant: { id: data.tenant.id, member: data.tenant.member ?? data.tenant.id },
      profile: data.profile === "saas" ? "saas" : "self-hosted",
      operator: data.operator ?? { name: null, repo: null },
    };
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
  { to: "/plan", label: "Meal plan", icon: IconCalendar, count: "plan" },
  { to: "/grocery", label: "Grocery list", icon: IconCart, count: "grocery" },
  { to: "/pantry", label: "Pantry", icon: IconPantry, count: null },
  // The People badge counts ACTIONABLE PENDING INBOUND requests — the same rows the
  // page's inbox renders, from the same aggregate read (the shared-derivation rule).
  // The mock's friend-count badge is a recorded defect, deliberately not reproduced.
  { to: "/people", label: "People", icon: IconUsers, count: "people" },
  { to: "/retrospective", label: "Retrospective", icon: IconClock, count: null },
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
  const { tenant, operator } = Route.useLoaderData();
  const [connectOpen, setConnectOpen] = React.useState(false);
  // Sidebar counts derive client-side from the already-cached area queries (design: no
  // counts endpoint), defined once in useSidebarCounts so a badge and its page can't
  // disagree — the shell subscribing warms those reads for the pages too.
  const counts: Record<string, number> = useSidebarCounts();

  return (
    <div className="app-shell" data-testid="app-shell">
      <aside className="app-sidebar">
        <div className="sb-brand">
          <span className="brand-mark sm">
            <IconBook />
          </span>
          <span className="brand-name">yamp</span>
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
        <div className="sb-connect-wrap">
          <button type="button" className="sb-connect" data-testid="connect-claude-cta" onClick={() => setConnectOpen(true)}>
            <IconSparkle />
            <span className="sb-connect-label">Connect to Claude.ai</span>
          </button>
        </div>
        <div className="sb-foot">
          <AccountMenu tenant={tenant.id} />
          <ThemeFab size="icon-sm" />
        </div>
      </aside>
      <main className="app-content" id="app-content">
        <Outlet />
      </main>
      <ConnectClaudeModal open={connectOpen} onOpenChange={setConnectOpen} operator={operator} />
      <OfflinePill />
    </div>
  );
}

function AccountMenu({ tenant }: { tenant: string }) {
  const [open, setOpen] = React.useState(false);
  const hostRef = React.useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const router = useRouter();
  const profile = useProfile();
  const [enrolling, setEnrolling] = React.useState(false);
  // "Install app" renders ONLY when the browser offered beforeinstallprompt and the
  // app isn't already standalone (D10) — platforms without the event get no dead item.
  const installable = useInstallAvailable();

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Self-service "add another device" (passkey-auth 8.2): the same enroll ceremony the
  // first-run nudge runs, from an already-authenticated session. Non-fatal — a declined or
  // failed enrollment leaves the session untouched; the toast is the only feedback.
  async function addDevice() {
    if (enrolling) return;
    setEnrolling(true);
    try {
      const outcome = await enrollPasskey();
      if (outcome.status === "ok") {
        toast("Passkey added — you can sign in with this device");
        setOpen(false);
      } else if (outcome.status === "failed") {
        toast(outcome.message);
      }
      // "cancelled" (dismissed sheet) is a silent non-event.
    } finally {
      setEnrolling(false);
    }
  }

  async function logout() {
    await api.api.session.$delete();
    // The deliberate identity event (D9): no member data at rest after sign-out —
    // the persisted cache, queued writes, stamp, and propose session all go.
    await purgeLocalMemberData();
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
          <button
            type="button"
            className="sb-menu-item"
            role="menuitem"
            data-testid="add-device"
            disabled={enrolling}
            onClick={addDevice}
          >
            {enrolling ? "Waiting for your device…" : "Add a device"}
          </button>
          {installable ? (
            <button
              type="button"
              className="sb-menu-item"
              role="menuitem"
              data-testid="install-app"
              onClick={() => {
                promptInstall();
                setOpen(false);
              }}
            >
              Install app
            </button>
          ) : null}
          <button type="button" className="sb-menu-item" role="menuitem" data-testid="logout" onClick={logout}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

