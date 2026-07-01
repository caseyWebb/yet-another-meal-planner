import { describe, it, expect } from "vitest";
import { MembersPage } from "../src/admin/pages/members.js";
import {
  MemberDetailPage,
  PendingMemberDetailPage,
  sectionSlug,
  sectionOfSlug,
  fmtPlanned,
  SECTIONS,
} from "../src/admin/pages/member-detail.js";
import type { TenantRosterRow } from "../src/admin.js";
import type { MemberDetail } from "../src/admin-data.js";

const render = (node: unknown): string => (node as { toString(): string }).toString();

const ACTIVE: TenantRosterRow = {
  id: "casey",
  owner: true,
  status: "active",
  kroger: "linked",
  joined: Date.now() - 10 * 86_400_000,
  lastActive: Date.now() - 3_600_000,
  cooked: 12,
  favorites: 4,
};

const PENDING: TenantRosterRow = {
  id: "noor",
  owner: false,
  status: "pending",
  kroger: "unlinked",
  joined: null,
  lastActive: null,
  cooked: 0,
  favorites: 0,
};

describe("Members roster SSR page", () => {
  it("renders the summary stat tiles matching the roster counts", () => {
    const html = render(MembersPage({ props: { members: [ACTIVE, PENDING] } }));
    expect(html).toContain("Members");
    expect(html).toContain("Active");
    expect(html).toContain("Pending");
    expect(html).toContain("Kroger linked");
    // Two members total, one active, one pending, one kroger-linked.
    expect(html).toContain(">2<");
    expect(html).toContain(">1<");
  });

  it("renders an owner badge, active/pending badges, and a kroger badge where applicable", () => {
    const html = render(MembersPage({ props: { members: [ACTIVE, PENDING] } }));
    expect(html).toContain("@casey");
    expect(html).toContain("@noor");
    expect(html).toContain("owner");
    expect(html).toContain("active");
    expect(html).toContain("pending");
    expect(html).toContain("kroger");
  });

  it("renders a pending member's invited-age meta line instead of activity counts", () => {
    const html = render(MembersPage({ props: { members: [PENDING] } }));
    expect(html).toContain("Awaiting Claude.ai connection");
    expect(html).not.toContain("recipes cooked");
  });

  it("renders the empty state with no members", () => {
    const html = render(MembersPage({ props: { members: [] } }));
    expect(html).toContain("No members yet.");
  });

  it("seeds the island props JSON with the structured roster rows", () => {
    const html = render(MembersPage({ props: { members: [ACTIVE] } }));
    expect(html).toContain('"id":"casey"');
    expect(html).toContain('"owner":true');
    expect(html).toContain("/admin/islands/members.js");
  });
});

describe("Member-detail section helpers", () => {
  it("round-trips every section through sectionSlug/sectionOfSlug", () => {
    for (const s of SECTIONS) {
      expect(sectionOfSlug(sectionSlug(s))).toBe(s);
    }
  });

  it("defaults to Profile for an unknown or absent slug", () => {
    expect(sectionOfSlug(undefined)).toBe("Profile");
    expect(sectionOfSlug("nonsense")).toBe("Profile");
  });

  it("uses hyphenated slugs for multi-word sections", () => {
    expect(sectionSlug("Meal plan")).toBe("meal-plan");
    expect(sectionSlug("Cooking log")).toBe("cooking-log");
  });

  it("formats a YYYY-MM-DD planned-for date as a weekday + month/day", () => {
    expect(fmtPlanned("2026-06-17")).toMatch(/^\w{3} · Jun 17$/);
  });
});

const memberDetail = (over: Partial<MemberDetail> = {}): MemberDetail => ({
  id: "casey",
  profile: {
    preferences: { default_cooking_nights: 3 },
    taste: null,
    diet_principles: null,
    kitchen: { owned: [], notes: {} },
    staples: [],
    ready_to_eat: [],
    stockup: null,
  },
  pantry: [],
  meal_plan: [],
  grocery_list: [],
  overlay: [],
  cooking_log: [],
  recipe_notes: [],
  store_notes: [],
  ...over,
});

describe("Member-detail SSR page", () => {
  it("renders the header with username, badges, and activity stats for an active member", () => {
    const html = render(MemberDetailPage({ row: ACTIVE, detail: memberDetail(), section: "Profile", titles: new Map() }));
    expect(html).toContain("@casey");
    expect(html).toContain("owner");
    expect(html).toContain("12 recipes cooked");
    expect(html).toContain("4 favorites");
    expect(html).toContain("All members");
  });

  it("renders the six-section pills sub-nav with the active section marked", () => {
    const html = render(MemberDetailPage({ row: ACTIVE, detail: memberDetail(), section: "Pantry", titles: new Map() }));
    for (const s of SECTIONS) expect(html).toContain(s);
    expect(html).toContain("/admin/members/casey/pantry");
    expect(html).toContain("pill active");
  });

  it("renders the Profile section as a PrettyKV table", () => {
    const html = render(
      MemberDetailPage({
        row: ACTIVE,
        detail: memberDetail({
          profile: {
            preferences: { lunch_strategy: "leftovers" },
            taste: null,
            diet_principles: null,
            kitchen: { owned: [], notes: {} },
            staples: [],
            ready_to_eat: [],
            stockup: null,
          },
        }),
        section: "Profile",
        titles: new Map(),
      }),
    );
    expect(html).toContain("lunch_strategy");
    expect(html).toContain("leftovers");
  });

  it("renders Pantry as a data table, or an empty state when empty", () => {
    const empty = render(MemberDetailPage({ row: ACTIVE, detail: memberDetail(), section: "Pantry", titles: new Map() }));
    expect(empty).toContain("Pantry is empty.");

    const withItems = render(
      MemberDetailPage({
        row: ACTIVE,
        detail: memberDetail({ pantry: [{ name: "rice", quantity: "2 lb", category: "grain", prepared_from: null, last_verified_at: "2026-06-01" }] }),
        section: "Pantry",
        titles: new Map(),
      }),
    );
    expect(withItems).toContain("rice");
    expect(withItems).toContain("2 lb");
  });

  it("renders Meal plan rows with a recipe title (via the titles map), scheduled date, and sides", () => {
    const html = render(
      MemberDetailPage({
        row: ACTIVE,
        detail: memberDetail({ meal_plan: [{ recipe: "miso-soup", planned_for: "2026-06-17", sides: ["rice"] }] }),
        section: "Meal plan",
        titles: new Map([["miso-soup", "Miso Soup"]]),
      }),
    );
    expect(html).toContain("Miso Soup");
    expect(html).toContain("miso-soup");
    expect(html).toContain("rice");
    expect(html).toContain("/admin/data/recipes/miso-soup");
  });

  it("renders an unscheduled meal-plan row distinctly", () => {
    const html = render(
      MemberDetailPage({
        row: ACTIVE,
        detail: memberDetail({ meal_plan: [{ recipe: "miso-soup", planned_for: null }] }),
        section: "Meal plan",
        titles: new Map(),
      }),
    );
    expect(html).toContain("Unscheduled");
  });

  it("renders Grocery rows with status, source, and for-recipe links", () => {
    const html = render(
      MemberDetailPage({
        row: ACTIVE,
        detail: memberDetail({
          grocery_list: [
            {
              name: "soy sauce",
              quantity: "1 bottle",
              kind: "grocery",
              domain: "grocery",
              status: "in_cart",
              source: "menu",
              for_recipes: ["miso-soup"],
              note: "almost out",
              added_at: "2026-06-01",
              ordered_at: null,
            },
          ],
        }),
        section: "Grocery",
        titles: new Map(),
      }),
    );
    expect(html).toContain("soy sauce");
    expect(html).toContain("in cart");
    expect(html).toContain("menu");
    expect(html).toContain("almost out");
    expect(html).toContain("/admin/data/recipes/miso-soup");
  });

  it("renders Cooking log rows, resolving a recipe entry's title via the titles map", () => {
    const html = render(
      MemberDetailPage({
        row: ACTIVE,
        detail: memberDetail({
          cooking_log: [{ id: 1, date: "2026-06-20", type: "recipe", recipe: "miso-soup", name: null, protein: "tofu", cuisine: "japanese" }],
        }),
        section: "Cooking log",
        titles: new Map([["miso-soup", "Miso Soup"]]),
      }),
    );
    expect(html).toContain("Miso Soup");
    expect(html).toContain("tofu");
    expect(html).toContain("japanese");
  });

  it("renders Notes as note cards, or an empty state when there are none", () => {
    const empty = render(MemberDetailPage({ row: ACTIVE, detail: memberDetail(), section: "Notes", titles: new Map() }));
    expect(empty).toContain("hasn&#39;t written any recipe notes");

    const withNotes = render(
      MemberDetailPage({
        row: ACTIVE,
        detail: memberDetail({
          recipe_notes: [{ id: "n1", recipe: "miso-soup", author: "casey", body: "double the miso", tags: ["umami"], private: 1, created_at: "2026-06-01" }],
        }),
        section: "Notes",
        titles: new Map(),
      }),
    );
    expect(withNotes).toContain("double the miso");
    expect(withNotes).toContain("private");
    expect(withNotes).toContain("umami");
  });

  it("does not show activity stats for a pending row passed to MemberDetailPage", () => {
    const html = render(MemberDetailPage({ row: PENDING, detail: memberDetail({ id: "noor" }), section: "Profile", titles: new Map() }));
    expect(html).not.toContain("recipes cooked");
  });
});

describe("Pending member detail empty state", () => {
  it("renders the not-yet-connected empty state, no sub-nav", () => {
    const html = render(PendingMemberDetailPage({ row: PENDING }));
    expect(html).toContain("@noor");
    expect(html).toContain("hasn&#39;t connected their Claude.ai yet");
    expect(html).not.toContain("data-nav");
    for (const s of SECTIONS) expect(html).not.toContain(`>${s}<`);
  });
});
