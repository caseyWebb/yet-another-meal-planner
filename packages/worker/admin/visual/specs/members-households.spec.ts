// The roster's HOUSEHOLD REGROUPING (households-friends-and-people-page): the Households
// stat tile, multi- vs single-member rendering, the split household/member action menus,
// the member-revoke flow against a self-provisioned member, the last-member routing, and
// household-purge clearing the social graph (observed through the member API). The
// destructive flows target per-run self-provisioned identities (a join-link member; a
// re-onboardable zoe), so re-runs against a reused server converge.
import { request as apiRequest, type APIRequestContext } from "@playwright/test";
import { test, expect } from "../fixtures";
import { SEED } from "../seed.mjs";

const CSRF = { "X-App-Csrf": "1" };
const PEOPLE = SEED.app.people;

/** A per-context synthetic client IP: the people/join limiters key per-IP with windows
 *  up to a day and their counters persist across local re-runs (shared .wrangler/state);
 *  a unique spoofed CF-Connecting-IP keeps each run inside its own buckets. */
function uniqueIp(): string {
  const b = () => 1 + Math.floor(Math.random() * 250);
  return `10.${b()}.${b()}.${b()}`;
}

/** A member-API session (the admin harness serves /api too) via an invite-code login.
 *  The session token rides an explicit cookie header: the `__Host-` cookie is Secure,
 *  and the API-request cookie jar drops Secure cookies over the harness's plain http. */
async function memberLogin(baseURL: string, inviteCode: string): Promise<APIRequestContext> {
  const login = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { "CF-Connecting-IP": uniqueIp() } });
  const res = await login.post("/api/session", { headers: CSRF, data: { invite_code: inviteCode } });
  if (!res.ok()) throw new Error(`member login failed (${res.status()})`);
  const setCookie = res.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")?.value ?? "";
  const token = /__Host-session=([^;]+)/.exec(setCookie)?.[1];
  await login.dispose();
  if (!token) throw new Error("login set no session cookie");
  return apiRequest.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `__Host-session=${token}`, "CF-Connecting-IP": uniqueIp() },
  });
}

test("the roster regroups by household: stat tiles + multi-member group + compact single row", async ({
  membersPage,
}) => {
  await membersPage.goto();
  await membersPage.landmark();
  // The Households tile joins the summary row (count and Members diverge: casey holds 2).
  await expect(membersPage.statTile("Households")).toBeVisible();
  // casey (two seeded members) renders as a GROUP: header with the member count, member
  // rows for the founding member and the ULID-minted second member.
  const group = membersPage.householdGroup(SEED.members.active);
  await expect(group).toBeVisible();
  await expect(group.getByTestId("household-count")).toHaveText("2 members");
  await expect(membersPage.memberRow(SEED.members.active)).toBeVisible();
  await expect(membersPage.memberRow(PEOPLE.secondMember.handle)).toBeVisible();
  // pat (single member) renders compactly — one row, NO group wrapper.
  await expect(membersPage.rosterRow(SEED.members.pending)).toBeVisible();
  await expect(membersPage.householdGroup(SEED.members.pending)).toHaveCount(0);
  await membersPage.captureForReview("members-households");
});

test("the action menus split household-level from member-level", async ({ membersPage, page }) => {
  await membersPage.goto();
  // The household header offers Kroger + Purge household — never member ops.
  await membersPage.openHouseholdMenu(SEED.members.active);
  await membersPage.expectNotPointerLocked();
  await expect(membersPage.menuItem("Purge household")).toBeVisible();
  await expect(membersPage.menuItem("Revoke member")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // A member row offers Rotate + Revoke member — never the purge.
  await membersPage.openMemberMenu(PEOPLE.secondMember.handle);
  await expect(membersPage.menuItem("Rotate invite")).toBeVisible();
  await expect(membersPage.menuItem("Revoke member")).toBeVisible();
  await expect(membersPage.menuItem("Purge household")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("member-revoke removes exactly one member; the household and its others survive", async ({
  membersPage,
  baseURL,
}) => {
  // Self-provision the victim: casey mints a household invite link; a visitor redeems it
  // with a per-run-unique handle (the join fork, exercised through the real API).
  const casey = await memberLogin(baseURL!, SEED.invite);
  const mintRes = await casey.post("/api/people/invites", { headers: CSRF, data: { tier: "household" } });
  expect(mintRes.status(), await mintRes.text()).toBe(200);
  const mint = (await mintRes.json()) as { token: string };
  const victimHandle = `vv${Date.now() % 1_000_000_000}`;
  const visitor = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { "CF-Connecting-IP": uniqueIp() } });
  const joined = await visitor.post(`/api/join/${mint.token}`, { headers: CSRF, data: { handle: victimHandle } });
  expect(joined.status(), await joined.text()).toBe(200);
  await visitor.dispose();

  await membersPage.goto();
  await expect(membersPage.memberRow(victimHandle)).toBeVisible();
  await membersPage.openMemberMenu(victimHandle);
  await membersPage.menuItem("Revoke member").click();
  await expect(membersPage.revokeDialog("Revoke member")).toBeVisible();
  await membersPage.captureForReview("members-revoke-member");
  await membersPage.revokeDialog("Revoke member").getByRole("button", { name: "Revoke member" }).click();

  // Exactly that member left; the household and its other members stand.
  await expect(membersPage.memberRow(victimHandle)).toHaveCount(0);
  await expect(membersPage.memberRow(SEED.members.active)).toBeVisible();
  await expect(membersPage.memberRow(PEOPLE.secondMember.handle)).toBeVisible();
  await casey.dispose();
});

test("household purge clears the social graph in both directions", async ({ membersPage, baseURL }) => {
  // (Re-)onboard zoe through the admin API — idempotent, and it re-mints her login code
  // after an earlier run's purge. Then zoe invites casey (a pending inbound social row).
  const admin = await apiRequest.newContext({ baseURL });
  const onboarded = (await (
    await admin.post("/admin/api/tenants", { data: { username: PEOPLE.requester.tenant } })
  ).json()) as { invite_code: string };
  const zoe = await memberLogin(baseURL!, onboarded.invite_code);
  const sent = await zoe.post("/api/people/requests", {
    headers: CSRF,
    data: { tier: "household", handle: SEED.members.active },
  });
  expect(sent.status(), await sent.text()).toBe(200);
  const casey = await memberLogin(baseURL!, SEED.invite);
  const before = (await (await casey.get("/api/people")).json()) as { inbox: { from_handle: string }[] };
  expect(before.inbox.some((r) => r.from_handle === PEOPLE.requester.handle)).toBeTruthy();

  // Purge zoe's household from the roster UI (her compact row's destructive action).
  await membersPage.goto();
  await membersPage.openRowMenu(PEOPLE.requester.tenant);
  await membersPage.menuItem(/Revoke (access|invite)/).click();
  await expect(membersPage.revokeDialog("Purge household")).toBeVisible();
  await membersPage.revokeDialog("Purge household").getByRole("button", { name: /Revoke/ }).click();
  await expect(membersPage.rosterRow(PEOPLE.requester.tenant)).toHaveCount(0);

  // No social row referencing the purged household survives: casey's inbox lost the
  // pending invitation with it.
  const after = (await (await casey.get("/api/people")).json()) as { inbox: { from_handle: string }[] };
  expect(after.inbox.some((r) => r.from_handle === PEOPLE.requester.handle)).toBeFalsy();
  await zoe.dispose();
  await casey.dispose();
  await admin.dispose();
});
