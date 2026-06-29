import { describe, it, expect } from "vitest";
import {
  RecipesListPage,
  RecipeDetailPage,
  MembersListPage,
  MemberDetailPage,
  DataTable,
  tierDetail,
} from "../src/admin/pages/data.js";
import type { RecipeDetail, RecipeListEntry, MemberDetail, TablePage } from "../src/admin-data.js";

const render = (node: unknown): string => (node as { toString(): string }).toString();

const recipes: RecipeListEntry[] = [
  { slug: "miso-soup", title: "Miso Soup", status: "indexed" },
  { slug: "orphan", title: null, status: "orphaned" },
];

const detail: RecipeDetail = {
  slug: "miso-soup",
  status: "indexed",
  reconcile_message: null,
  source: "# Miso",
  body: "# Miso\n\nsoup",
  projection: { slug: "miso-soup" },
  derived: { description: "A warm soup", has_embedding: true, state: "described" },
  dispositions: [{ tenant: "casey", favorite: true, reject: false }],
  notes: [],
};

const member = {
  id: "casey",
  profile: { diet: "veg" },
  pantry: [{ item: "rice" }],
  meal_plan: [],
  grocery_list: [],
  overlay: [],
  cooking_log: [],
  recipe_notes: [],
  store_notes: [],
} as unknown as MemberDetail;

const table: TablePage = { table: "feeds", columns: ["url", "weight"], rows: [{ url: "http://x", weight: 5 }] };

describe("Data explorer SSR views", () => {
  it("renders the recipe list with slug links + status badges", () => {
    const html = render(RecipesListPage({ recipes }));
    expect(html).toContain("/admin/data/recipes/miso-soup");
    expect(html).toContain("tier indexed");
    expect(html).toContain("orphaned");
  });

  it("renders the recipe detail (tier text, description, dispositions, body)", () => {
    const html = render(RecipeDetailPage({ detail }));
    expect(html).toContain("← all recipes");
    expect(html).toContain("A warm soup");
    expect(html).toContain("embedding: present");
    expect(html).toContain("casey");
    expect(html).toContain("favorite");
  });

  it("maps the projection tier to its explanation", () => {
    expect(tierDetail({ ...detail, status: "skipped", reconcile_message: "bad yaml" })).toContain("bad yaml");
    expect(tierDetail({ ...detail, status: "orphaned" })).toContain("stale projection");
    expect(tierDetail({ ...detail, status: "pending" })).toContain("reconcile hasn't run");
  });

  it("renders the member list + detail sections", () => {
    expect(render(MembersListPage({ ids: ["alex", "casey"] }))).toContain("/admin/data/members/casey");
    const html = render(MemberDetailPage({ detail: member }));
    expect(html).toContain("← all members");
    expect(html).toContain("Profile");
    expect(html).toContain("rice");
  });

  it("renders a generic table with its columns + rows, and an empty state", () => {
    expect(render(DataTable({ page: table }))).toContain("http://x");
    expect(render(DataTable({ page: { table: "feeds", columns: ["url"], rows: [] } }))).toContain("No rows");
  });
});
