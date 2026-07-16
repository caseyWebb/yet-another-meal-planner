// People — the SELF-HOSTED (default-server) variant + the profile-neutral mechanics
// (households-friends-and-people-page): the household-only layout, nickname edit +
// empty-clear + the live hint example, invite mint/copy/cancel, awaiting rows with
// cancel, decline invisibility (the requester's view is byte-identical), the sidebar
// badge, and remove-with-confirm against a member the spec itself joins through a real
// invite link. Inbound requests are SELF-PROVISIONED through the requester identity's
// API session (SEED.app.people.requester), so re-runs against a reused server converge.
import { request as apiRequest, type APIRequestContext } from "@playwright/test";
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";
import { CSRF, activeMemberContext, freshSender, uniqueIp } from "../api-session";

const PEOPLE = SEED.app.people;

/** Cancel every awaiting request the identity holds (cap hygiene across reruns). */
async function cancelAllAwaiting(ctx: APIRequestContext): Promise<void> {
  const people = (await (await ctx.get("/api/people")).json()) as {
    awaiting: { requests: { id: string }[] };
  };
  for (const r of people.awaiting.requests) {
    await ctx.post(`/api/people/requests/${r.id}/cancel`, { headers: CSRF });
  }
}

test("self-hosted variant: household carries the page; no friend surface renders", async ({ peoplePage }) => {
  await peoplePage.goto();
  await peoplePage.landmark();
  await expect(peoplePage.variant()).toHaveAttribute("data-profile", "self-hosted");
  // The friends clause is dropped from the header; no FRIENDS section, adder, or badge.
  await expect(peoplePage.page.locator(".page-head")).toContainText(
    "Everyone you cook alongside. Your household shares your pantry and meal plan.",
  );
  await expect(peoplePage.page.locator(".page-head")).not.toContainText("cookbook");
  await expect(peoplePage.friendsSection()).toHaveCount(0);
  await expect(peoplePage.page.getByTestId("adder-friend")).toHaveCount(0);
  // The household roster renders both seeded members; the hint sits beside it.
  await expect(peoplePage.memberRow(SEED.members.active).getByText("You")).toBeVisible();
  await expect(peoplePage.memberRow(PEOPLE.secondMember.handle)).toBeVisible();
  await expect(peoplePage.page.getByTestId("nickname-hint")).toBeVisible();
  await peoplePage.captureForReview("people-self-hosted");
});

test("nickname edit, the live hint example, and the empty-save clear", async ({ peoplePage, baseURL }) => {
  // Converge: clear every alias casey holds (earlier specs/runs may have seeded some —
  // e.g. a join redemption's display name).
  const casey = await activeMemberContext(baseURL!);
  const aggregate = (await (await casey.get("/api/people")).json()) as {
    members: { id: string; nickname: string | null }[];
    friends: { member: { id: string }; nickname: string | null }[];
  };
  for (const m of aggregate.members.filter((m) => m.nickname)) {
    await casey.put(`/api/people/nicknames/${m.id}`, { headers: CSRF, data: { nickname: "" } });
  }
  for (const f of aggregate.friends.filter((f) => f.nickname)) {
    await casey.put(`/api/people/nicknames/${f.member.id}`, { headers: CSRF, data: { nickname: "" } });
  }
  await casey.dispose();

  await peoplePage.goto();
  await peoplePage.expectNoNickname(PEOPLE.secondMember.handle);
  // Generic example while the viewer has no nicknames.
  await expect(peoplePage.nicknameExample()).toContainText("Mom and Grandma");

  await peoplePage.setNickname(PEOPLE.secondMember.handle, "Mom");
  await peoplePage.expectNickname(PEOPLE.secondMember.handle, "Mom");
  // The hint's example recomposes from the REAL nickname on the next aggregate read.
  await peoplePage.goto();
  await expect(peoplePage.nicknameExample()).toContainText("Mom is coming to town");
  await peoplePage.captureForReview("people-nickname");

  // Empty save clears — back to "Add a nickname".
  await peoplePage.setNickname(PEOPLE.secondMember.handle, "");
  await peoplePage.expectNoNickname(PEOPLE.secondMember.handle);
});

test("invite link: mint with Copied! feedback, awaiting row, cancel revokes", async ({ peoplePage }) => {
  await peoplePage.goto();
  await peoplePage.mintInvite("household");
  // Track the SPECIFIC minted token (the seeded landing token and any prior run's
  // residue share the list) — extracted from the popover's copyable link.
  const link = await peoplePage.page.getByTestId("invite-link").inputValue();
  const token = /\/join\/(.+)$/.exec(link)?.[1] ?? "";
  expect(token).not.toBe("");
  await peoplePage.page.getByTestId("invite-copy").click();
  await expect(peoplePage.page.getByTestId("invite-copy")).toHaveText(/Copied!/);
  // The awaiting list gains the link with a cancel affordance; cancel revokes it.
  await peoplePage.goto();
  const minted = peoplePage.page.locator(`[data-testid="awaiting-invite"][data-token="${token}"]`);
  await expect(minted).toBeVisible();
  await minted.getByTestId("awaiting-invite-cancel").click();
  await expect(minted).toHaveCount(0);
});

test("decline is locally unceremonious and remotely INVISIBLE (requester view byte-identical)", async ({
  peoplePage,
  baseURL,
}) => {
  const { ctx: sender, handle } = await freshSender(baseURL!);
  // The fresh household invites casey into it, with a note.
  const send = await sender.post("/api/people/requests", {
    headers: CSRF,
    data: { tier: "household", handle: SEED.members.active, note: "Cook with us!", display_name: "Zed Q." },
  });
  expect(send.ok()).toBeTruthy();
  const viewBefore = JSON.stringify(
    ((await (await sender.get("/api/people")).json()) as { awaiting: unknown }).awaiting,
  );

  await peoplePage.goto();
  const row = peoplePage.inboxRow(handle);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("inbox-note")).toContainText("Cook with us!");
  await expect(row).toContainText("invites you to join their household");
  await peoplePage.captureForReview("people-inbox");
  await peoplePage.decline(handle);
  await expect(peoplePage.inboxRow(handle)).toHaveCount(0);

  // The requester's awaiting view is BYTE-identical — still "Request sent".
  const viewAfter = JSON.stringify(
    ((await (await sender.get("/api/people")).json()) as { awaiting: unknown }).awaiting,
  );
  expect(viewAfter).toBe(viewBefore);
  await sender.dispose();
});

test("the sidebar People badge counts pending inbound requests and clears with them", async ({
  peoplePage,
  shellPage,
  baseURL,
}) => {
  const { ctx: sender, handle } = await freshSender(baseURL!);
  await sender.post("/api/people/requests", {
    headers: CSRF,
    data: { tier: "household", handle: SEED.members.active },
  });

  await peoplePage.goto();
  const badge = shellPage.page.locator('.sb-link:has-text("People") .sb-count');
  await expect(badge).toHaveText("1");
  await peoplePage.decline(handle);
  await expect(badge).toHaveCount(0); // zero renders NO badge
  await sender.dispose();
});

test("awaiting rows read 'Request sent' with cancel; remove works via confirm on a link-joined member", async ({
  peoplePage,
  baseURL,
}) => {
  // Self-provision a removable third member: mint a household link as casey and redeem
  // it signed-out with a per-run-unique handle (re-run safe).
  const casey = await activeMemberContext(baseURL!);
  const mintRes = await casey.post("/api/people/invites", { headers: CSRF, data: { tier: "household" } });
  expect(mintRes.status(), await mintRes.text()).toBe(200);
  const mint = (await mintRes.json()) as { token: string };
  const guestHandle = `guest${Date.now() % 1_000_000_000}`;
  const visitor = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { "CF-Connecting-IP": uniqueIp() } });
  const joined = await visitor.post(`/api/join/${mint.token}`, {
    headers: CSRF,
    data: { handle: guestHandle, display_name: "Guest" },
  });
  expect(joined.ok()).toBeTruthy();
  await visitor.dispose();

  // An outgoing request so the awaiting list has a request row too.
  await cancelAllAwaiting(casey);
  await casey.post("/api/people/requests", {
    headers: CSRF,
    data: { tier: "household", handle: PEOPLE.requester.handle },
  });

  await peoplePage.goto();
  const awaiting = peoplePage.awaitingRow(PEOPLE.requester.handle);
  await expect(awaiting.getByTestId("awaiting-status")).toContainText("Request sent");
  await peoplePage.captureForReview("people-awaiting");
  await awaiting.getByTestId("awaiting-cancel").click();
  await expect(peoplePage.awaitingRow(PEOPLE.requester.handle)).toHaveCount(0);

  // The link-joined member renders with the sender-seeded nickname; remove them behind
  // the explicit confirm (nothing removes instantly).
  const guestRow = peoplePage.memberRow(guestHandle);
  await expect(guestRow).toBeVisible();
  await expect(guestRow.getByTestId("member-nickname")).toHaveText("Guest");
  await guestRow.getByTestId("member-remove").click();
  await expect(peoplePage.page.getByTestId("remove-dialog")).toBeVisible();
  await peoplePage.page.getByTestId("remove-confirm").click();
  await expect(peoplePage.memberRow(guestHandle)).toHaveCount(0);
  await casey.dispose();
});
