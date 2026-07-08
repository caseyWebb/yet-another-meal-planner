// Profile (member-app-core 7.10–7.12): the derived taste read, the class (a)
// markdown editor's 412 REBASE flow (a competing writer forces the notice; saving
// again applies), the preferences merge-patch knobs, and the night-vibes tab —
// empty palette + pending queue (production's observed state), kind-specific
// confirm/dismiss, and the quiet throttled suggest state (the seeded
// archetype-derive health is fresh, so the gate answers throttled).
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

test.beforeEach(async ({ asMember, profilePage }) => {
  await asMember();
  await profilePage.goto();
  await profilePage.landmark();
});

test("the taste tab renders the derived read and the seeded markdown", async ({ profilePage }) => {
  await profilePage.expectTasteView(SEED.app.tasteLead);
  await profilePage.captureForReview("profile-taste");
});

test("a lost class (a) race 412s, surfaces the rebase notice, and the retry applies", async ({
  profilePage,
}) => {
  await profilePage.openTasteEditor();
  await profilePage.typeTaste("My edit, drafted while someone else saved.");
  // A competing writer moves the document under the open editor.
  await profilePage.competingTasteWrite("The other writer got here first.");
  await profilePage.saveTaste();
  await profilePage.expectRebaseNotice(); // refused with 412 — nothing clobbered
  await profilePage.captureForReview("profile-rebase-notice");
  await profilePage.saveTaste(); // the precondition was refreshed with the notice
  await profilePage.expectTasteView("My edit, drafted while someone else saved.");
});

test("preferences knobs persist through the merge-patch (reload keeps the value)", async ({
  profilePage,
}) => {
  await profilePage.openTab("prefs");
  await profilePage.setCookingNights(4);
  await profilePage.expectCookingNights(4);
  await profilePage.goto();
  await profilePage.openTab("prefs");
  await profilePage.expectCookingNights(4);
  await profilePage.captureForReview("profile-prefs");
});

test("night vibes: empty palette + pending queue; accept applies, dismiss retires", async ({
  profilePage,
}) => {
  await profilePage.openTab("vibes");
  await profilePage.expectPaletteEmpty(); // production's first render
  await expect(profilePage.proposalRows()).toHaveCount(4);
  await profilePage.captureForReview("profile-vibes-queue");

  // Accept an add_vibe: the vibe lands in the palette and leaves the queue for good.
  await profilePage.acceptProposal(SEED.app.proposals.addA.vibe);
  await expect(profilePage.proposalRows()).toHaveCount(3);
  await expect(profilePage.vibeRows()).toHaveCount(1);

  // Dismiss is durable: the proposal leaves and the palette is untouched.
  await profilePage.dismissProposal(SEED.app.proposals.addB.vibe);
  await expect(profilePage.proposalRows()).toHaveCount(2);
  await expect(profilePage.vibeRows()).toHaveCount(1);

  // Reload: the dismissed proposal never re-surfaces (recorded status, stable id).
  await profilePage.goto();
  await profilePage.openTab("vibes");
  await expect(profilePage.proposalRows()).toHaveCount(2);
});

test("a merge_recipes proposal renders the pair honestly — Dismiss only, no accept button", async ({
  profilePage,
}) => {
  const merge = SEED.app.proposals.merge;
  await profilePage.openTab("vibes");
  const row = profilePage.proposal(merge.titles[0]);
  // The pair title names BOTH recipes; the rationale and the chat hint render; and per
  // the kind-specific-actions rule the app offers NO accept/merge button for this kind
  // (the merge itself is agent-guided in chat — accept's meaning only exists there).
  await expect(row).toContainText(merge.titles[0]);
  await expect(row).toContainText(merge.titles[1]);
  await expect(row).toContainText("look like the same dish");
  await expect(profilePage.mergeChatHint()).toBeVisible();
  await expect(profilePage.proposalAccept(merge.titles[0])).toHaveCount(0);
  await profilePage.captureForReview("profile-merge-proposal");

  // Dismiss (confirm-reject, replay-safe like every proposal confirm) resolves it durably.
  await profilePage.dismissProposal(merge.titles[0]);
  await expect(row).toHaveCount(0);
  await profilePage.goto();
  await profilePage.openTab("vibes");
  await expect(profilePage.proposal(merge.titles[0])).toHaveCount(0);
  await expect(profilePage.proposalRows()).toHaveCount(1); // only the prune remains
});

test("the suggest trigger surfaces the quiet throttled state (fresh job health)", async ({
  profilePage,
}) => {
  await profilePage.openTab("vibes");
  await profilePage.suggest();
  await profilePage.expectToast("Suggestions are fresh");
});
