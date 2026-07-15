// The `/join/:token` landing (households-friends-and-people-page, self-service-signup
// fork): an SPA route absorbed by the asset fallback — NO `run_worker_first` entry and
// no service-worker denylist change. It reads the PUBLIC token endpoint and renders:
// the tiered framing for a valid token, the account-creation form (handle or username
// chooser per tier, optional display name, then the same passkey-enroll continuation as
// signup) for signed-out visitors, the signed-in conversion (household-accept
// confirmation from the SERVER-SUPPLIED manifest, or the friend confirm), and ONE
// uniform invalid-or-expired state for any dead token — unknown, expired, revoked, and
// redeemed are indistinguishable by design.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button, IconBook, Input, Label } from "@yamp/ui";
import { appFetch, apiError } from "../lib/api";
import { enrollPasskey } from "../lib/passkey";
import { purgeLocalMemberData, readTenantStamp, writeTenantStamp } from "../lib/persist";
import { ThemeFab } from "./_app";

export const Route = createFileRoute("/join/$token")({
  component: JoinPage,
});

interface TokenView {
  inviter_handle: string;
  tier: "household" | "friend";
  deployment: string | null;
  signed_in: boolean;
}

type LandingState =
  | { status: "loading" }
  | { status: "dead" }
  | { status: "live"; view: TokenView };

type SubmitState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "failed"; field: "handle" | "form"; message: string };

type Phase =
  | { kind: "form" }
  | { kind: "confirm"; not_carried_over: string[]; reconnect: string }
  | { kind: "enroll" }
  | { kind: "done"; message: string };

function JoinPage() {
  const { token } = Route.useParams();
  const [landing, setLanding] = useState<LandingState>({ status: "loading" });
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await appFetch(`/api/join/${encodeURIComponent(token)}`).catch(() => null);
      if (cancelled) return;
      if (!res || !res.ok) {
        setLanding({ status: "dead" });
        return;
      }
      setLanding({ status: "live", view: (await res.json()) as TokenView });
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function redeem(body: Record<string, unknown>): Promise<void> {
    setState({ status: "busy" });
    try {
      const res = await appFetch(`/api/join/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!res) {
        setState({ status: "failed", field: "form", message: "Couldn't reach the server. Try again." });
        return;
      }
      if (res.ok) {
        const done = (await res.json()) as {
          status: "ok" | "confirm_required";
          tier: "household" | "friend";
          tenant?: { id: string; member: string };
          not_carried_over?: string[];
          reconnect?: string;
        };
        if (done.status === "confirm_required") {
          setPhase({ kind: "confirm", not_carried_over: done.not_carried_over ?? [], reconnect: done.reconnect ?? "" });
          setState({ status: "idle" });
          return;
        }
        if (landing.status === "live" && !landing.view.signed_in && done.tenant) {
          // A fresh account was minted and the session cookie set — same identity
          // discipline as signup: purge a different member's local data, stamp, enroll.
          const stamped = readTenantStamp();
          if (stamped && stamped !== done.tenant.id) await purgeLocalMemberData();
          writeTenantStamp(done.tenant.id);
          setPhase({ kind: "enroll" });
          setState({ status: "idle" });
          return;
        }
        if (done.tier === "household") {
          // A signed-in mover changed households: local data belongs to the old one.
          await purgeLocalMemberData();
          if (done.tenant) writeTenantStamp(done.tenant.id);
        }
        setPhase({
          kind: "done",
          message:
            done.tier === "household" ? "You're in — welcome to the household." : "You're friends now — their shared recipes will show up in your cookbook.",
        });
        setState({ status: "idle" });
        return;
      }
      const err = await apiError(res);
      if (err.error === "invalid_or_expired") {
        setLanding({ status: "dead" });
      } else if (err.error === "handle_taken" || err.error === "username_taken") {
        setState({ status: "failed", field: "handle", message: "That one's taken — try another." });
      } else if (err.error === "validation_failed") {
        setState({ status: "failed", field: "handle", message: err.message || "Pick a valid handle." });
      } else if (err.error === "rate_limited") {
        setState({ status: "failed", field: "form", message: "Too many attempts — wait a minute and try again." });
      } else {
        setState({ status: "failed", field: "form", message: err.message || "That didn't work — try again." });
      }
    } finally {
      setState((s) => (s.status === "busy" ? { status: "idle" } : s));
    }
  }

  async function onEnroll() {
    setState({ status: "busy" });
    const outcome = await enrollPasskey();
    if (outcome.status === "ok" || outcome.status === "cancelled") {
      window.location.assign("/");
      return;
    }
    setState({ status: "failed", field: "form", message: outcome.message });
  }

  const handleError = state.status === "failed" && state.field === "handle" ? state.message : null;
  const formError = state.status === "failed" && state.field === "form" ? state.message : null;

  return (
    <div className="login-wrap">
      <ThemeFab />
      <div className="login-card" data-testid="join-page">
        <div className="login-brand">
          <span className="brand-mark">
            <IconBook />
          </span>
          <div>
            <div className="brand-name">yamp</div>
            <div className="brand-tag">your kitchen, with the agent</div>
          </div>
        </div>

        {landing.status === "loading" ? (
          <p className="login-note">Checking your invite…</p>
        ) : landing.status === "dead" ? (
          // ONE terminal state for every dead token — nothing distinguishes the causes.
          <div data-testid="join-dead">
            <p className="login-note" role="alert">
              This invite link isn't valid anymore. Ask whoever shared it for a fresh one.
            </p>
            <p className="login-note">
              Already have an account?{" "}
              <Link to="/login" data-testid="join-to-login">
                Sign in
              </Link>
              .
            </p>
          </div>
        ) : phase.kind === "enroll" ? (
          <div className="login-form" data-testid="enroll-prompt">
            <div>
              <div className="brand-name">Add a passkey</div>
              <p className="login-note" style={{ marginTop: "0.35rem" }}>
                Sign in from now on with your device — Face ID, Touch ID, or a security key.
              </p>
            </div>
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <Button type="button" className="login-submit" data-testid="enroll-passkey" disabled={state.status === "busy"} onClick={onEnroll}>
              {state.status === "busy" ? "Waiting for your device…" : "Add a passkey"}
            </Button>
            <Button type="button" variant="ghost" className="login-submit" data-testid="enroll-skip" onClick={() => window.location.assign("/")}>
              Not now
            </Button>
          </div>
        ) : phase.kind === "done" ? (
          <div data-testid="join-done">
            <p className="login-note">{phase.message}</p>
            <Button type="button" className="login-submit" onClick={() => window.location.assign("/")}>
              Open your cookbook
            </Button>
          </div>
        ) : phase.kind === "confirm" ? (
          <div className="login-form" data-testid="join-confirm">
            <div className="brand-name">Before you join</div>
            <p className="login-note">These won't carry over from your current household:</p>
            <ul className="login-note" style={{ margin: 0, paddingLeft: "1.2rem" }} data-testid="join-manifest">
              {phase.not_carried_over.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="login-note">{phase.reconnect}</p>
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <Button
              type="button"
              className="login-submit"
              data-testid="join-confirm-go"
              disabled={state.status === "busy"}
              onClick={() => redeem({ confirm: true, ...(displayName.trim() ? { display_name: displayName.trim() } : {}) })}
            >
              {state.status === "busy" ? "Joining…" : "Join household"}
            </Button>
          </div>
        ) : (
          <JoinForm
            view={landing.view}
            handle={handle}
            setHandle={setHandle}
            displayName={displayName}
            setDisplayName={setDisplayName}
            handleError={handleError}
            formError={formError}
            busy={state.status === "busy"}
            onSubmit={(body) => void redeem(body)}
          />
        )}
      </div>
    </div>
  );
}

function JoinForm({
  view,
  handle,
  setHandle,
  displayName,
  setDisplayName,
  handleError,
  formError,
  busy,
  onSubmit,
}: {
  view: TokenView;
  handle: string;
  setHandle: (v: string) => void;
  displayName: string;
  setDisplayName: (v: string) => void;
  handleError: string | null;
  formError: string | null;
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const household = view.tier === "household";
  const framing = household
    ? `@${view.inviter_handle} invited you to join their household`
    : `@${view.inviter_handle} invited you to be friends${view.deployment ? ` on ${view.deployment}` : ""}`;

  if (view.signed_in) {
    // The signed-in conversion: household converts to the accept flow (the server
    // answers confirm_required with the manifest); friend confirms the edge.
    return (
      <div className="login-form" data-testid="join-signed-in">
        <p className="login-note" data-testid="join-framing">
          {framing}
        </p>
        {formError ? (
          <p className="text-sm text-destructive" role="alert">
            {formError}
          </p>
        ) : null}
        <Button
          type="button"
          className="login-submit"
          data-testid="join-continue"
          disabled={busy}
          onClick={() => onSubmit(household ? {} : { confirm: true })}
        >
          {busy ? "One moment…" : household ? "Continue" : "Accept — be friends"}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="login-form"
      data-testid="join-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          [household ? "handle" : "username"]: handle.trim(),
          ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
        });
      }}
    >
      <p className="login-note" data-testid="join-framing">
        {framing}
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="join-handle">{household ? "Choose your handle" : "Choose a username"}</Label>
        <Input
          id="join-handle"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="e.g. grandma_j"
        />
        {handleError ? (
          <p className="text-sm text-destructive" role="alert" data-testid="join-handle-error">
            {handleError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="join-name">Your name (optional)</Label>
        <Input
          id="join-name"
          autoComplete="off"
          maxLength={40}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="How they'll see you, e.g. Grandma"
        />
      </div>
      {formError ? (
        <p className="text-sm text-destructive" role="alert" data-testid="join-error">
          {formError}
        </p>
      ) : null}
      <Button type="submit" className="login-submit" data-testid="join-submit" disabled={busy || handle.trim() === ""}>
        {busy ? "Joining…" : household ? "Join the household" : "Create account & be friends"}
      </Button>
    </form>
  );
}
