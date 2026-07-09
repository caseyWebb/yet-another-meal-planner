// The cross-device MCP approval screen (passkey-auth 8.3). Claude.ai's `/authorize` page
// can't run a passkey ceremony in its OAuth browser, so it deep-links the member here with
// `?authz=<ref>`; this passkey-authenticated screen names the requesting client, shows the
// verification code to match against the /authorize screen, and binds the member's tenant to
// the reference on Approve — the /authorize poll then completes the OAuth grant. An
// unauthenticated visit is parked at /login and returned here afterward (the ref is preserved
// through the round trip). It is a client-side route (SPA fallback) — deliberately NOT in
// wrangler.jsonc's run_worker_first.
import { useEffect, useState } from "react";
import { createFileRoute, redirect, type SearchSchemaInput } from "@tanstack/react-router";
import { Button, IconBook } from "@grocery-agent/ui";
import { api } from "../lib/api";
import { approveConnection, fetchPendingApproval, type PendingApproval } from "../lib/passkey";
import { ThemeFab } from "./_app";

export const Route = createFileRoute("/connect")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => ({
    authz: typeof s.authz === "string" ? s.authz : "",
  }),
  // Gate on a live session (like the app shell) — but park the member at /login carrying
  // this exact URL so they return to the same pending reference after signing in. A network
  // failure is left to the component's pending fetch to report; only a definitive 401 bounces.
  loader: async ({ location }) => {
    const res = await api.api.session.$get().catch(() => null);
    if (res?.status === 401) {
      // A guaranteed-relative return path (pathname + raw query) — login's safeDest only
      // honors same-origin relative targets, so this survives the round trip intact.
      throw redirect({ to: "/login", search: { redirect: `${location.pathname}${location.searchStr}` } });
    }
  },
  component: ConnectPage,
});

/** The screen's lifecycle: one union so busy/approved/gone/error states can't overlap. */
type View =
  | { kind: "loading" }
  | { kind: "ready"; approval: PendingApproval; busy: boolean; error?: string }
  | { kind: "approved" }
  | { kind: "gone" }
  | { kind: "error"; message: string };

function ConnectPage() {
  const { authz } = Route.useSearch();
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    if (!authz) {
      setView({ kind: "gone" });
      return;
    }
    void fetchPendingApproval(authz).then((outcome) => {
      if (!live) return;
      if (outcome.status === "ok") {
        // An already-approved reference (a reload after approving) shows the done state.
        setView(
          outcome.approval.status === "approved"
            ? { kind: "approved" }
            : { kind: "ready", approval: outcome.approval, busy: false },
        );
      } else if (outcome.status === "not_found") {
        setView({ kind: "gone" });
      } else {
        setView({ kind: "error", message: outcome.message });
      }
    });
    return () => {
      live = false;
    };
  }, [authz]);

  async function onApprove() {
    if (view.kind !== "ready" || view.busy) return;
    const approval = view.approval;
    setView({ kind: "ready", approval, busy: true });
    const outcome = await approveConnection(authz);
    if (outcome.status === "ok") {
      setView({ kind: "approved" });
    } else if (outcome.status === "not_found") {
      setView({ kind: "gone" });
    } else {
      setView({ kind: "ready", approval, busy: false, error: outcome.message });
    }
  }

  return (
    <div className="login-wrap">
      <ThemeFab />
      <div className="login-card" data-testid="connect-screen">
        <div className="login-brand">
          <span className="brand-mark">
            <IconBook />
          </span>
          <div>
            <div className="brand-name">Cookbook</div>
            <div className="brand-tag">connect a device</div>
          </div>
        </div>

        {view.kind === "loading" ? (
          <p className="login-note" style={{ marginTop: 0 }} data-testid="connect-loading">
            Looking up the request…
          </p>
        ) : null}

        {view.kind === "ready" ? (
          <div className="login-form">
            <div className="brand-name">Connect to Claude?</div>
            <p className="login-note" style={{ marginTop: "0.35rem" }}>
              <strong data-testid="connect-client">{view.approval.clientName}</strong> is asking to
              connect to your Cookbook account. Check that this code matches the one on the connection
              screen before you approve.
            </p>
            <div className="connect-code" data-testid="connect-code">
              {view.approval.code}
            </div>
            {view.error ? (
              <p className="text-sm text-destructive" role="alert" data-testid="connect-error">
                {view.error}
              </p>
            ) : null}
            <Button
              type="button"
              className="login-submit"
              data-testid="connect-approve"
              disabled={view.busy}
              onClick={onApprove}
            >
              {view.busy ? "Connecting…" : "Approve"}
            </Button>
          </div>
        ) : null}

        {view.kind === "approved" ? (
          <div className="login-form" data-testid="connect-approved">
            <div className="brand-name">Connected</div>
            <p className="login-note" style={{ marginTop: "0.35rem" }}>
              You can return to Claude — the connection is complete.
            </p>
          </div>
        ) : null}

        {view.kind === "gone" ? (
          <div className="login-form" data-testid="connect-gone">
            <div className="brand-name">Request expired</div>
            <p className="login-note" style={{ marginTop: "0.35rem" }}>
              This connection request is no longer valid. Start again from Claude to get a new one.
            </p>
          </div>
        ) : null}

        {view.kind === "error" ? (
          <div className="login-form" data-testid="connect-error-state">
            <p className="text-sm text-destructive" role="alert">
              {view.message}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
