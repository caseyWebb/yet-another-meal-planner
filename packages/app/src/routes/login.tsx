// The invite-code login screen (member-session-auth, restyled per member-app-core
// D13): the design bundle's login card — brand mark, ONE invite-code field, submit —
// over P0's session POST. No roster, no password (the mock's fake-auth affordances);
// the structured-error copy stays uniform (`unauthorized` never hints whether a code
// exists; `rate_limited` asks for patience). A success lands on `/`.
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button, IconBook, Input, Label } from "@grocery-agent/ui";
import { api, apiError } from "../lib/api";
import { ThemeFab } from "./_app";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

/** One union for the submit lifecycle — busy and failed cannot coexist. */
type LoginState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "failed"; error: string; message: string };

function messageFor(error: string, fallback: string): string {
  if (error === "unauthorized") return "That invite code didn't work. Check it with whoever runs your group.";
  if (error === "rate_limited") return "Too many attempts — wait a minute and try again.";
  return fallback || "Something went wrong. Try again.";
}

function LoginPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [state, setState] = useState<LoginState>({ status: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: "busy" });
    const res = await api.api.session.$post({ json: { invite_code: code.trim() } }).catch(() => null);
    if (res?.ok) {
      void navigate({ to: "/" });
      return;
    }
    if (!res) {
      setState({ status: "failed", error: "network", message: "Couldn't reach the server. Try again." });
      return;
    }
    const err = await apiError(res);
    setState({ status: "failed", error: err.error, message: messageFor(err.error, err.message) });
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
            <div className="brand-name">Cookbook</div>
            <div className="brand-tag">your kitchen, with the agent</div>
          </div>
        </div>
        <form className="login-form" onSubmit={onSubmit} data-testid="login-form">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-code">Invite code</Label>
            <Input
              id="invite-code"
              name="invite_code"
              autoComplete="off"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 1a2b3c4d5e6f7a8b"
            />
          </div>
          {state.status === "failed" ? (
            <p className="text-sm text-destructive" role="alert" data-testid="login-error">
              {state.message}
            </p>
          ) : null}
          <Button type="submit" className="login-submit" disabled={state.status === "busy" || code.trim() === ""}>
            {state.status === "busy" ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="login-note">Sign in with the invite code from your group's operator.</p>
      </div>
    </div>
  );
}
