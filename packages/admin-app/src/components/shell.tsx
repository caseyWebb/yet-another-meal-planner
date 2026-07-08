// The admin shell's global chrome (operator-admin): the fixed-corner service-health
// indicator (present on every area — D6: it subscribes to the SAME ["status"] query the
// Status screen renders from, kept honest by that query's refetchInterval + focus refetch),
// the blocking Access-expired reload overlay (D7), and the light/dark theme toggle (D10).
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@grocery-agent/ui";
import { statusQuery } from "../lib/queries";
import { subscribeAccessExpired, accessExpiredSnapshot } from "../lib/api";
import { ChevronDownIcon, ExternalLinkIcon, SunMoonIcon } from "./icons";

// ── Health rollup (ported from ui/health-dock.tsx — same projection, same precedence) ──

interface HealthDep {
  name: string;
  state: "ok" | "fail" | "muted";
  word: string;
}

interface HealthPayloadish {
  ok: boolean;
  jobs: { name: string; ok: boolean | null }[];
  d1: { ok: boolean };
  admin: { access_configured: boolean; email_allowlist: boolean; dev_bypass_set: boolean; exposed: boolean };
}

/** The admin-gate dependency row, by the same precedence the badge uses (exposed > gated > dev). */
function gateDep(payload: HealthPayloadish): HealthDep {
  const a = payload.admin;
  if (a.exposed) return { name: "admin gate", state: "fail", word: "exposed" };
  if (a.access_configured) return { name: "admin gate", state: "ok", word: "gated" };
  if (a.dev_bypass_set) return { name: "admin gate", state: "muted", word: "dev bypass" };
  return { name: "admin gate", state: "muted", word: "disabled" };
}

/** Project the payload to the indicator's rollup. An `exposed` gate renders as degraded,
 *  consistent with the Status area's prominent posture warning (the spec's requirement). */
export function buildHealthRollup(payload: HealthPayloadish): { ok: boolean; failingJobs: string[]; deps: HealthDep[] } {
  const failingJobs = payload.jobs.filter((j) => j.ok === false).map((j) => j.name);
  const deps: HealthDep[] = [
    { name: "d1", state: payload.d1.ok ? "ok" : "fail", word: payload.d1.ok ? "reachable" : "unreachable" },
    gateDep(payload),
  ];
  return { ok: payload.ok && !payload.admin.exposed, failingJobs, deps };
}

/** The global corner health indicator. Renders nothing until the shared status read first
 *  resolves (the SSR dock likewise only existed once the server had the payload). */
export function HealthIndicator(): React.ReactElement | null {
  const status = useQuery(statusQuery);
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (status.status !== "success") return null;
  const rollup = buildHealthRollup(status.data.payload);
  const cls = rollup.ok ? "ok" : "fail";
  const word = rollup.ok ? "Healthy" : "Degraded";

  return (
    <div className="health-dock" ref={ref}>
      {open ? (
        <div className="health-pop" role="dialog" aria-label="Service health">
          <div className="hp-head">
            <span className={`pulse-dot ${cls}`} />
            <span className={`status-word ${cls}`}>{word}</span>
          </div>
          {rollup.failingJobs.length > 0 ? (
            <ul className="hp-fail-list">
              {rollup.failingJobs.map((name) => (
                <li key={name}>
                  <span className="dot fail" />
                  <span className="hp-fail-name">{name}</span>
                  <span className="muted small">failing</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small" style={{ margin: ".6rem 0 0" }}>
              All background jobs healthy.
            </p>
          )}
          <div className="hp-deps">
            {rollup.deps.map((dep) => (
              <div className="hp-dep" key={dep.name}>
                <span className={`dot ${dep.state}`} />
                <span className="hp-dep-name">{dep.name}</span>
                <span className={`status-word ${dep.state}`}>{dep.word}</span>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" className="hp-link" asChild>
            <Link to="/" onClick={() => setOpen(false)}>
              Open status <ExternalLinkIcon size={13} />
            </Link>
          </Button>
        </div>
      ) : null}
      <button
        className={`health-pill ${cls}`}
        type="button"
        aria-label={`Service health: ${word}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`pulse-dot ${cls}`} />
        <span className={`status-word ${cls}`}>{word}</span>
        {!rollup.ok && rollup.failingJobs.length > 0 ? <span className="hp-count">{rollup.failingJobs.length}</span> : null}
        <ChevronDownIcon size={13} className={open ? "hp-caret up" : "hp-caret"} />
      </button>
    </div>
  );
}

// ── Deployed-build footer ──

/** A persistent footer showing the code SHA the Worker is actually running (`env.APP_BUILD`,
 *  surfaced on the status payload; "dev" locally and in tests) plus the contract version — so the
 *  operator can confirm at a glance what's live after a deploy. Reads the SAME shared ["status"]
 *  query the health indicator does (no extra fetch); renders once it resolves. */
export function AppFooter(): React.ReactElement | null {
  const status = useQuery(statusQuery);
  if (status.status !== "success") return null;
  return (
    <footer className="app-footer" data-testid="app-footer">
      <span>
        build <code>{status.data.appBuild}</code>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        contract <code>{status.data.contractVersion}</code>
      </span>
    </footer>
  );
}

// ── Access-expired overlay (D7) ──

function useAccessExpired(): boolean {
  return React.useSyncExternalStore(subscribeAccessExpired, accessExpiredSnapshot, accessExpiredSnapshot);
}

/** The blocking "session expired" overlay: a full reload re-runs the Access flow and lands
 *  back on the same URL (deep links are routes). */
export function AccessExpiredOverlay(): React.ReactElement | null {
  const expired = useAccessExpired();
  if (!expired) return null;
  return (
    <div className="access-overlay" role="alertdialog" aria-modal="true" aria-label="Session expired">
      <div className="access-overlay-card">
        <h2 style={{ marginBottom: ".5rem" }}>Session expired</h2>
        <p className="muted" style={{ margin: "0 0 1rem" }}>
          Your Cloudflare Access session has expired (or the Worker is unreachable). Reload to sign back in — you
          will land right back on this page.
        </p>
        <Button onClick={() => location.reload()}>Reload to sign back in</Button>
      </div>
    </div>
  );
}

// ── Theme toggle (D10 — `.dark` on <html>, persisted, pre-paint script in index.html) ──

export function ThemeToggle(): React.ReactElement {
  const [dark, setDark] = React.useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("ga-theme", next ? "dark" : "light");
    } catch {
      // private-mode storage failures leave the toggle session-only
    }
  };
  return (
    <button className="theme-toggle" type="button" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={toggle}>
      <SunMoonIcon size={15} />
    </button>
  );
}
