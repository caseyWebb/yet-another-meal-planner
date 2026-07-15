// The `/join/:token` landing (households-friends-and-people-page): the tiered framing
// for a valid token, the uniform dead-token terminal state, and the signed-out
// household redemption end-to-end — handle chooser, optional display name, the standard
// member-bound session, and the passkey-enroll continuation. Runs in the NOAUTH project
// (genuinely signed out); the redemption link is minted per-run through casey's API
// session so re-runs never fight over a consumed single-use token. The seeded landing
// token is only ever READ (GETs never consume).
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";
import { CSRF, memberLogin } from "../api-session";

const PEOPLE = SEED.app.people;

test("a valid household link renders the inviter's framing and the handle chooser", async ({ page }) => {
  await page.goto(`/join/${PEOPLE.inviteToken}`);
  await expect(page.getByTestId("join-page")).toBeVisible();
  await expect(page.getByTestId("join-framing")).toContainText(
    `@${SEED.members.active} invited you to join their household`,
  );
  await expect(page.getByTestId("join-form")).toBeVisible();
  await page.screenshot({ path: "app/visual/.screenshots/join-landing.png", fullPage: true });
});

test("a dead token renders ONE terminal state (unknown here — revoked/expired/redeemed are byte-identical server-side)", async ({
  page,
}) => {
  await page.goto("/join/definitely-not-a-token");
  await expect(page.getByTestId("join-dead")).toBeVisible();
  await expect(page.getByTestId("join-form")).toHaveCount(0);
  await page.screenshot({ path: "app/visual/.screenshots/join-dead.png", fullPage: true });
});

test("signed-out redemption: choose a handle, join the household, land on the enroll prompt", async ({
  page,
  baseURL,
}) => {
  // Mint a fresh single-use link through the inviter's API session.
  const casey = await memberLogin(baseURL!, SEED.invite);
  const mintRes = await casey.post("/api/people/invites", { headers: CSRF, data: { tier: "household" } });
  expect(mintRes.status(), await mintRes.text()).toBe(200);
  const mint = (await mintRes.json()) as { token: string };
  await casey.dispose();

  const handle = `nb${Date.now() % 1_000_000_000}`; // grammar-valid, per-run unique
  await page.goto(`/join/${mint.token}`);
  await page.getByLabel(/Choose your handle/).fill(handle);
  await page.getByLabel(/Your name/).fill("Newbie");
  await page.getByTestId("join-submit").click();

  // The standard member-bound session was minted — the enroll continuation renders.
  await expect(page.getByTestId("enroll-prompt")).toBeVisible();
  await page.getByTestId("enroll-skip").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  // The new member lives in the INVITER's household (no new tenant).
  await expect(page.getByTestId("account-menu")).toContainText(`@${SEED.members.active}`);

  // The same link is single-use: a second visit shows the uniform dead state.
  await page.goto(`/join/${mint.token}`);
  await expect(page.getByTestId("join-dead")).toBeVisible();

  // Converge: evict the member this run created (per-run-unique handles would otherwise
  // fill casey's 8-member cap across local re-runs against a reused state dir).
  const janitor = await memberLogin(baseURL!, SEED.invite);
  const aggregate = (await (await janitor.get("/api/people")).json()) as {
    members: { id: string; handle: string }[];
  };
  const created = aggregate.members.find((m) => m.handle === handle);
  if (created) await janitor.post(`/api/people/members/${created.id}/remove`, { headers: CSRF });
  await janitor.dispose();
});
