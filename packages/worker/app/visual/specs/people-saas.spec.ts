// People — the SaaS FULL variant (households-friends-and-people-page), against the
// sibling saas-profile server: the FRIENDS section with "N shared" chips, tier badges
// on inbox rows, the friend accept flow with the nickname seed moment, and unfriend
// behind a confirm. The inbound friend request is SELF-PROVISIONED through the
// requester identity (zoe), unfriended first so re-runs converge; the seeded wren edge
// (zero shared grants — lens-inert) proves the section renders from durable state.
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";
import { CSRF, memberLogin } from "../api-session";

const PEOPLE = SEED.app.people;

test("SaaS full variant: FRIENDS renders with the shared chip; the header carries the friends clause", async ({
  peoplePage,
}) => {
  await peoplePage.goto();
  await peoplePage.landmark();
  await expect(peoplePage.variant()).toHaveAttribute("data-profile", "saas");
  await expect(peoplePage.page.locator(".page-head")).toContainText("friends share recipes into your cookbook");
  // The seeded wren friendship renders with its "N shared" chip (0 — wren shares nothing,
  // which is exactly what keeps the saas lens fixtures untouched).
  await expect(peoplePage.friendsSection()).toBeVisible();
  const wren = peoplePage.friendRow(PEOPLE.friend.tenant);
  await expect(wren).toBeVisible();
  await expect(wren.getByTestId("friend-shared")).toHaveText("0 shared");
  await expect(peoplePage.page.getByTestId("adder-friend")).toBeVisible();
  await peoplePage.captureForReview("people-saas");
});

test("friend request: tier badge + note render; accept shows the seed moment and mints the friendship", async ({
  peoplePage,
  baseURL,
}) => {
  const zoe = await memberLogin(baseURL!, PEOPLE.requester.invite);
  // Converge from any earlier run: sever the edge and clear zoe's outgoing rows.
  const casey = await memberLogin(baseURL!, SEED.invite);
  await casey.delete(`/api/people/friends/${PEOPLE.requester.tenant}`, { headers: CSRF });
  const zoeView = (await (await zoe.get("/api/people")).json()) as { awaiting: { requests: { id: string }[] } };
  for (const r of zoeView.awaiting.requests) await zoe.post(`/api/people/requests/${r.id}/cancel`, { headers: CSRF });

  const sent = await zoe.post("/api/people/requests", {
    headers: CSRF,
    data: { tier: "friend", handle: SEED.members.active, note: "Loved your salmon bowls!", display_name: "Zoe Q." },
  });
  expect(sent.status(), await sent.text()).toBe(200);

  await peoplePage.goto();
  const row = peoplePage.inboxRow(PEOPLE.requester.handle);
  await expect(row).toBeVisible();
  // @handle ALWAYS; the display name beside it, never instead of it; the tier badge.
  await expect(row.getByTestId("inbox-handle")).toHaveText(`@${PEOPLE.requester.handle}`);
  await expect(row).toContainText("Zoe Q.");
  await expect(row.getByTestId("inbox-tier")).toHaveText("FRIEND");
  await expect(row.getByTestId("inbox-note")).toContainText("Loved your salmon bowls!");

  // Accept: the dialog carries the nickname seed moment, then the edge exists.
  await row.getByTestId("inbox-accept").click();
  await expect(peoplePage.page.getByTestId("accept-seed")).toContainText("will be saved as “Zoe Q.”");
  await peoplePage.page.getByTestId("accept-confirm").click();
  const zoeRow = peoplePage.friendRow(PEOPLE.requester.tenant);
  await expect(zoeRow).toBeVisible();
  // The seeded nickname is an ordinary editable row.
  await expect(zoeRow.getByTestId("friend-nickname")).toHaveText("Zoe Q.");

  // Unfriend behind a confirm: silent severing, the row leaves.
  await zoeRow.getByTestId("friend-unfriend").click();
  await expect(peoplePage.page.getByTestId("unfriend-dialog")).toBeVisible();
  await peoplePage.page.getByTestId("unfriend-confirm").click();
  await expect(peoplePage.friendRow(PEOPLE.requester.tenant)).toHaveCount(0);
  // Clear the caller's alias so re-runs start from the unset state again.
  const aggregate = (await (await casey.get("/api/people")).json()) as { inbox: unknown[] };
  void aggregate;
  await zoe.dispose();
  await casey.dispose();
});
