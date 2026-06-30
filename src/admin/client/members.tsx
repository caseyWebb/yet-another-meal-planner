// The Members island (operator-admin): hydrates the server-rendered #members-island with the
// interactive onboard / rotate / revoke controls, seeded from the page's JSON props. Mutations
// call the typed `/admin/api/*` routes via `hc<AdminApp>` (zero codegen). The in-flight
// mutation + its target + its failure are ONE union (ActionState) so they cannot contradict
// and one-at-a-time is structural (admin/CLAUDE.md discipline, ported to TS).

import { render, useState } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import type { MembersIslandProps } from "../shared.js";

const client = hc<AdminApp>(location.origin);

// The "show once" banner: either freshly-minted invite credentials or a single-use Kroger
// consent link for a member. One field, two variants — so the two banners can't both be set
// in contradictory ways (admin/CLAUDE.md discipline, ported from the Elm `Minted` type).
type Banner =
  | { kind: "invite"; username: string; invite_code: string; connector_url: string }
  | { kind: "kroger"; username: string; url: string };

type Op =
  | { kind: "onboard" }
  | { kind: "rotate"; id: string }
  | { kind: "kroger"; id: string }
  | { kind: "revoke"; id: string };

type ActionState =
  | { status: "idle" }
  | { status: "busy"; op: Op }
  | { status: "failed"; op: Op; message: string };

function errMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as Record<string, unknown>).message;
    if (typeof m === "string") return m;
  }
  return "Something went wrong.";
}

function MembersIsland(initial: MembersIslandProps) {
  const [members, setMembers] = useState<string[]>(initial.members);
  const [username, setUsername] = useState("");
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const [banner, setBanner] = useState<Banner | null>(null);

  const busy = action.status === "busy";

  async function refresh(): Promise<void> {
    const res = await client.admin.api.tenants.$get();
    if (res.ok) setMembers((await res.json()).tenants);
  }

  async function doOnboard(e: Event): Promise<void> {
    e.preventDefault();
    if (!username.trim()) return;
    setAction({ status: "busy", op: { kind: "onboard" } });
    const res = await client.admin.api.tenants.$post({ json: { username } });
    if (res.ok) {
      const data = await res.json();
      setBanner({ kind: "invite", username: data.username, invite_code: data.invite_code, connector_url: data.connector_url });
      setUsername("");
      setAction({ status: "idle" });
      await refresh();
    } else {
      setAction({ status: "failed", op: { kind: "onboard" }, message: errMessage(await res.json()) });
    }
  }

  async function doRotate(id: string): Promise<void> {
    setAction({ status: "busy", op: { kind: "rotate", id } });
    const res = await client.admin.api.tenants[":id"].rotate.$post({ param: { id } });
    if (res.ok) {
      const data = await res.json();
      setBanner({ kind: "invite", username: data.username, invite_code: data.invite_code, connector_url: data.connector_url });
      setAction({ status: "idle" });
    } else {
      setAction({ status: "failed", op: { kind: "rotate", id }, message: errMessage(await res.json()) });
    }
  }

  async function doKrogerLink(id: string): Promise<void> {
    setAction({ status: "busy", op: { kind: "kroger", id } });
    const res = await client.admin.api.tenants[":id"]["kroger-login"].$post({ param: { id } });
    if (res.ok) {
      const data = await res.json();
      setBanner({ kind: "kroger", username: id, url: data.url });
      setAction({ status: "idle" });
    } else {
      setAction({ status: "failed", op: { kind: "kroger", id }, message: errMessage(await res.json()) });
    }
  }

  async function doRevoke(id: string): Promise<void> {
    setAction({ status: "busy", op: { kind: "revoke", id } });
    const res = await client.admin.api.tenants[":id"].$delete({ param: { id } });
    if (res.ok) {
      setAction({ status: "idle" });
      await refresh();
    } else {
      setAction({ status: "failed", op: { kind: "revoke", id }, message: errMessage(await res.json()) });
    }
  }

  return (
    <div>
      {banner ? (
        <div class="minted">
          <div class="minted-head">
            <strong>{banner.kind === "kroger" ? `Kroger consent link for ${banner.username}` : banner.username}</strong>
            <button class="btn" data-variant="ghost" data-size="sm" onClick={() => setBanner(null)}>
              dismiss
            </button>
          </div>
          <p class="once">
            {banner.kind === "kroger"
              ? "Give this link to the member to open and authorize Kroger. Single-use, expires in ~10 minutes; never logged."
              : "Shown once — copy the invite now."}
          </p>
          {banner.kind === "invite" ? (
            <div class="row">
              <span class="k">invite code</span>
              <span class="v">{banner.invite_code}</span>
            </div>
          ) : null}
          {banner.kind === "invite" ? (
            <div class="row">
              <span class="k">connector</span>
              <span class="v">{banner.connector_url}</span>
            </div>
          ) : null}
          {banner.kind === "kroger" ? (
            <div class="row">
              <span class="k">consent url</span>
              <span class="v">{banner.url}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {action.status === "failed" ? (
        <div class="alert" data-variant="destructive">
          <section>{action.message}</section>
        </div>
      ) : null}
      <table class="table">
        <thead>
          <tr>
            <th>member</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr>
              <td>{m}</td>
              <td class="form-actions">
                <button class="btn" data-variant="ghost" data-size="sm" disabled={busy} onClick={() => doRotate(m)}>
                  rotate invite
                </button>
                <button class="btn" data-variant="ghost" data-size="sm" disabled={busy} onClick={() => doKrogerLink(m)}>
                  {action.status === "busy" && action.op.kind === "kroger" && action.op.id === m ? "minting…" : "kroger link"}
                </button>
                <button class="btn" data-variant="destructive" data-size="sm" disabled={busy} onClick={() => doRevoke(m)}>
                  revoke
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form class="form-actions" onSubmit={doOnboard}>
        <input
          class="input"
          type="text"
          placeholder="username"
          value={username}
          onInput={(e: Event) => setUsername((e.target as HTMLInputElement).value)}
        />
        <button type="submit" class="btn" data-size="sm" disabled={busy}>
          onboard
        </button>
      </form>
    </div>
  );
}

const host = document.getElementById("members-island");
const propsEl = document.getElementById("members-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as MembersIslandProps;
  host.replaceChildren();
  render(<MembersIsland members={props.members} />, host);
}
