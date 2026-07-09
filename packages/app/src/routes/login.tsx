// The login screen (member-session-auth + passkey-auth): passkey sign-in is the primary,
// usernameless action; the single invite-code field stays below as the single-use bootstrap
// path. After a successful invite login the card advances to a first-run enrollment prompt —
// a member who bootstrapped with a code is nudged to add a passkey so the code (now consumed
// on enrollment) is the last time they ever type it. Passkey sign-in navigates straight to /.
// The structured-error copy stays uniform (auth failures never hint whether a credential or
// code exists); a dismissed/absent passkey is a neutral non-event, never a crash.
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { Button, IconBook, Input, Label } from "@yamp/ui";
import { api, apiError } from "../lib/api";
import { enrollPasskey, passkeyLogin } from "../lib/passkey";
import { purgeLocalMemberData, readTenantStamp, writeTenantStamp } from "../lib/persist";
import { restoreQueue, suspendQueue } from "../lib/online";
import { ThemeFab } from "./_app";

export const Route = createFileRoute("/login")({
  // `?redirect=<path>` is where a gated route (e.g. /connect) parks the member; login
  // returns them there on success instead of /. Optional; the SearchSchemaInput marker
  // keeps it off Links that don't set it.
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
  }),
  component: LoginPage,
});

/** Only ever bounce to a same-origin relative path — never an attacker-supplied absolute
 *  URL or protocol-relative `//host` (open-redirect guard on the `redirect` param). */
function safeDest(redirect: string | undefined): string {
  if (redirect && redirect.startsWith("/") && !redirect.startsWith("//")) return redirect;
  return "/";
}

/** One union for the submit lifecycle — busy and failed cannot coexist. */
type LoginState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "failed"; error: string; message: string };

/** Which card the screen shows: the credential choices, or (post-bootstrap-login) the
 *  passkey enrollment nudge for the now-authenticated member. */
type Phase = { kind: "credentials" } | { kind: "enroll"; tenant: string };

function messageFor(error: string, fallback: string): string {
  if (error === "unauthorized") return "That invite code didn't work. Check it with whoever runs your group.";
  if (error === "rate_limited") return "Too many attempts — wait a minute and try again.";
  return fallback || "Something went wrong. Try again.";
}

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [code, setCode] = useState("");
  const [state, setState] = useState<LoginState>({ status: "idle" });
  const [phase, setPhase] = useState<Phase>({ kind: "credentials" });

  // Where a completed login lands: the parked return path (a full navigation, so its
  // loader re-runs under the fresh cookie), or / via the SPA router.
  function goAfterLogin() {
    const dest = safeDest(redirect);
    if (dest === "/") void navigate({ to: "/" });
    else window.location.assign(dest);
  }

  // One-shot version check (member-app-offline D7 / P0 D11's stated pre-login
  // purpose): a login screen makes no other request until submit, so this is the
  // only thing that can trigger a pre-login service-worker update check. The response
  // header rides the shared fetch wrapper's X-App-Build tap; failures are irrelevant.
  useEffect(() => {
    api.api.version.$get().catch(() => {});
  }, []);

  // The stamp/purge identity side effects both login paths share (member-app-offline D9):
  // a DIFFERENT member than the device's stamp purges first (no query, queued mutation, or
  // propose state crosses identities); the same member re-entering keeps the cache.
  async function applyIdentity(tenant: string, stamped: string | null): Promise<void> {
    if (stamped && stamped !== tenant) await purgeLocalMemberData();
    writeTenantStamp(tenant);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: "busy" });
    // Close the cross-tenant replay window (member-app-offline D9): the stamp-mismatch
    // purge below necessarily runs after the session POST resolves (the target tenant
    // is unknown before that) — so whenever a stamp is already on the device, suspend
    // the shared class (b) queue for the whole submission first. A fresh device (no
    // stamp) has nothing queued to leak, so it skips suspension entirely.
    const stamped = readTenantStamp();
    if (stamped) suspendQueue();
    try {
      const res = await api.api.session.$post({ json: { invite_code: code.trim() } }).catch(() => null);
      if (res?.ok) {
        const { tenant } = (await res.json()) as { tenant: { id: string } };
        await applyIdentity(tenant.id, stamped);
        // Bootstrap login lands on the enrollment nudge, not straight into the app: the
        // code is single-use and dies on the passkey the member is about to add.
        setState({ status: "idle" });
        setPhase({ kind: "enroll", tenant: tenant.id });
        return;
      }
      if (!res) {
        setState({ status: "failed", error: "network", message: "Couldn't reach the server. Try again." });
        return;
      }
      const err = await apiError(res);
      setState({ status: "failed", error: err.error, message: messageFor(err.error, err.message) });
    } finally {
      // Restore in every branch: after the purge on a mismatch, immediately on a
      // same-tenant re-entry or a failed attempt (restoreQueue is navigator-truthful —
      // it never forces the queue back online when the device is really offline).
      if (stamped) restoreQueue();
    }
  }

  async function onPasskeyLogin() {
    setState({ status: "busy" });
    // Same replay-window discipline as the invite path: the resolved tenant is unknown
    // until the assertion verifies, so suspend a stamped device's queue for the ceremony.
    const stamped = readTenantStamp();
    if (stamped) suspendQueue();
    try {
      const outcome = await passkeyLogin();
      if (outcome.status === "ok") {
        await applyIdentity(outcome.tenant.id, stamped);
        goAfterLogin();
        return;
      }
      if (outcome.status === "cancelled") {
        // Dismissed sheet / no passkey / unsupported browser — no error, just fall back.
        setState({ status: "idle" });
        return;
      }
      setState({ status: "failed", error: "passkey", message: outcome.message });
    } finally {
      if (stamped) restoreQueue();
    }
  }

  async function onEnroll() {
    setState({ status: "busy" });
    const outcome = await enrollPasskey();
    if (outcome.status === "ok") {
      goAfterLogin();
      return;
    }
    if (outcome.status === "cancelled") {
      // Declined the sheet — non-fatal; leave the nudge up so they can retry or skip.
      setState({ status: "idle" });
      return;
    }
    setState({ status: "failed", error: "passkey", message: outcome.message });
  }

  return (
    <div className="login-wrap">
      <ThemeFab />
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark">
            <IconBook />
          </span>
          <div>
            <div className="brand-name">yamp</div>
            <div className="brand-tag">your kitchen, with the agent</div>
          </div>
        </div>

        {phase.kind === "enroll" ? (
          <div className="login-form" data-testid="enroll-prompt">
            <div>
              <div className="brand-name">Add a passkey</div>
              <p className="login-note" style={{ marginTop: "0.35rem" }}>
                Sign in from now on with your device — Face ID, Touch ID, or a security key. No more
                typing that code.
              </p>
            </div>
            {state.status === "failed" ? (
              <p className="text-sm text-destructive" role="alert" data-testid="enroll-error">
                {state.message}
              </p>
            ) : null}
            <Button
              type="button"
              className="login-submit"
              data-testid="enroll-passkey"
              disabled={state.status === "busy"}
              onClick={onEnroll}
            >
              {state.status === "busy" ? "Waiting for your device…" : "Add a passkey"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="login-submit"
              data-testid="enroll-skip"
              disabled={state.status === "busy"}
              onClick={goAfterLogin}
            >
              Not now
            </Button>
          </div>
        ) : (
          <>
            <Button
              type="button"
              className="login-submit"
              data-testid="passkey-login"
              disabled={state.status === "busy"}
              onClick={onPasskeyLogin}
            >
              {state.status === "busy" ? "Signing in…" : "Sign in with a passkey"}
            </Button>
            {state.status === "failed" && state.error === "passkey" ? (
              <p className="text-sm text-destructive" role="alert" data-testid="passkey-error">
                {state.message}
              </p>
            ) : null}

            <div className="login-divider">
              <span>or use an invite code</span>
            </div>

            <form className="login-form" onSubmit={onSubmit} data-testid="login-form">
              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-code">Invite code</Label>
                <Input
                  id="invite-code"
                  name="invite_code"
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. 1a2b3c4d5e6f7a8b"
                />
              </div>
              {state.status === "failed" && state.error !== "passkey" ? (
                <p className="text-sm text-destructive" role="alert" data-testid="login-error">
                  {state.message}
                </p>
              ) : null}
              <Button
                type="submit"
                variant="outline"
                className="login-submit"
                data-testid="invite-submit"
                disabled={state.status === "busy" || code.trim() === ""}
              >
                {state.status === "busy" ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </>
        )}

        <p className="login-note">
          {phase.kind === "enroll" ? (
            "You can add more devices any time from your account menu."
          ) : (
            <>
              Have a group invite code?{" "}
              <Link to="/signup" data-testid="login-to-signup">
                Create your account
              </Link>
              .
            </>
          )}
        </p>
      </div>
    </div>
  );
}
