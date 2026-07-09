// The self-service signup screen (self-service-signup): a visitor redeems a group invite code
// under a username they choose, which creates their own new tenant and signs them in — then the
// same first-run enrollment nudge login uses, so they add a passkey (the durable credential)
// straight away. `username_taken` is surfaced INLINE on the username field so they can pick
// another; every unusable-code case stays uniform (no oracle). Mirrors login.tsx's structure.
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button, IconBook, Input, Label } from "@yamp/ui";
import { api, apiError } from "../lib/api";
import { enrollPasskey } from "../lib/passkey";
import { purgeLocalMemberData, readTenantStamp, writeTenantStamp } from "../lib/persist";
import { restoreQueue, suspendQueue } from "../lib/online";
import { ThemeFab } from "./_app";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

/** One union for the submit lifecycle — busy and failed cannot coexist. `field` places the
 *  failure: "username" (taken / invalid → inline under that input) or "form" (the code failed,
 *  rate-limited, or network → under the submit). */
type SignupState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "failed"; field: "username" | "form"; message: string };

/** Same two-phase shape as login: the signup form, then the first-run passkey enrollment nudge
 *  for the now-authenticated new member. */
type Phase = { kind: "form" } | { kind: "enroll"; tenant: string };

function SignupPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState<SignupState>({ status: "idle" });
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  // A completed signup always lands on the app root (a fresh account has no parked return path).
  function goAfterSignup() {
    void navigate({ to: "/" });
  }

  // A login screen makes no request until submit, so this is the only pre-submit trigger for a
  // service-worker update check (mirrors login.tsx); failures are irrelevant.
  useEffect(() => {
    api.api.version.$get().catch(() => {});
  }, []);

  // The stamp/purge identity side effects both entry paths share: a DIFFERENT member than the
  // device's stamp purges first. A brand-new device has no stamp, so this is usually a no-op.
  async function applyIdentity(tenant: string, stamped: string | null): Promise<void> {
    if (stamped && stamped !== tenant) await purgeLocalMemberData();
    writeTenantStamp(tenant);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: "busy" });
    // Same cross-tenant replay discipline as login: the new tenant is unknown until the POST
    // resolves, so suspend a stamped device's queue for the submission (no-op on a fresh device).
    const stamped = readTenantStamp();
    if (stamped) suspendQueue();
    try {
      const res = await api.api.signup
        .$post({ json: { code: code.trim(), username: username.trim() } })
        .catch(() => null);
      if (res?.ok) {
        const { tenant } = (await res.json()) as { tenant: { id: string } };
        await applyIdentity(tenant.id, stamped);
        setState({ status: "idle" });
        setPhase({ kind: "enroll", tenant: tenant.id });
        return;
      }
      if (!res) {
        setState({ status: "failed", field: "form", message: "Couldn't reach the server. Try again." });
        return;
      }
      const err = await apiError(res);
      if (err.error === "username_taken") {
        setState({ status: "failed", field: "username", message: "That username is taken — try another." });
      } else if (err.error === "validation_failed") {
        setState({ status: "failed", field: "username", message: err.message || "Pick a valid username." });
      } else if (err.error === "rate_limited") {
        setState({ status: "failed", field: "form", message: "Too many attempts — wait a minute and try again." });
      } else {
        // unauthorized (unknown / exhausted / expired / revoked code) — stays uniform.
        setState({ status: "failed", field: "form", message: "That invite code didn't work. Check it with whoever shared it." });
      }
    } finally {
      if (stamped) restoreQueue();
    }
  }

  async function onEnroll() {
    setState({ status: "busy" });
    const outcome = await enrollPasskey();
    if (outcome.status === "ok") {
      goAfterSignup();
      return;
    }
    if (outcome.status === "cancelled") {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "failed", field: "form", message: outcome.message });
  }

  const usernameError = state.status === "failed" && state.field === "username" ? state.message : null;
  const formError = state.status === "failed" && state.field === "form" ? state.message : null;

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
              onClick={goAfterSignup}
            >
              Not now
            </Button>
          </div>
        ) : (
          <>
            <p className="login-note" style={{ marginBottom: "0.25rem" }}>
              Have a group invite code? Pick a username and join.
            </p>
            <form className="login-form" onSubmit={onSubmit} data-testid="signup-form">
              <div className="flex flex-col gap-2">
                <Label htmlFor="signup-username">Username</Label>
                <Input
                  id="signup-username"
                  name="username"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. alex"
                />
                {usernameError ? (
                  <p className="text-sm text-destructive" role="alert" data-testid="signup-username-error">
                    {usernameError}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="signup-code">Invite code</Label>
                <Input
                  id="signup-code"
                  name="code"
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. 1a2b3c4d5e6f7a8b"
                />
              </div>
              {formError ? (
                <p className="text-sm text-destructive" role="alert" data-testid="signup-error">
                  {formError}
                </p>
              ) : null}
              <Button
                type="submit"
                className="login-submit"
                data-testid="signup-submit"
                disabled={state.status === "busy" || username.trim() === "" || code.trim() === ""}
              >
                {state.status === "busy" ? "Creating your account…" : "Create account"}
              </Button>
            </form>
          </>
        )}

        <p className="login-note">
          {phase.kind === "enroll" ? (
            "You can add more devices any time from your account menu."
          ) : (
            <>
              Already have an account?{" "}
              <Link to="/login" data-testid="signup-to-login">
                Sign in
              </Link>
              .
            </>
          )}
        </p>
      </div>
    </div>
  );
}
