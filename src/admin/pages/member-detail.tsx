// The Members › member-detail area (operator-admin), server-rendered at its own URL so a
// deep link or refresh loads the selected section directly (admin/CLAUDE.md SSR-for-reads;
// design.md decision 2 — SSR sub-routes, not client-side island state). Each section renders
// from the existing `memberDetail()` read the Data area's per-tenant explorer already uses —
// no separate or duplicated read path (`recipeTitles` is the one additive join, for the
// meal-plan/grocery sections' recipe titles `memberDetail()` doesn't carry).

import type { Child } from "hono/jsx";
import { Layout } from "../ui/layout.js";
import { Badge, PrettyKV, DataTable } from "../ui/kit.js";
import { LinkIcon, ChevronLeftIcon } from "../ui/icons.js";
import { relAge } from "./status.js";
import type { TenantRosterRow } from "../../admin.js";
import type { MemberDetail as MemberDetailData } from "../../admin-data.js";

export const SECTIONS = ["Profile", "Pantry", "Meal plan", "Grocery", "Cooking log", "Notes"] as const;
export type Section = (typeof SECTIONS)[number];

/** The URL segment for each pill (lowercase, hyphenated — `meal-plan`, `cooking-log`). */
export function sectionSlug(s: Section): string {
  return s.toLowerCase().replace(/\s+/g, "-");
}

/** The reverse of `sectionSlug`, defaulting to "Profile" for an unknown/absent segment. */
export function sectionOfSlug(slug: string | undefined): Section {
  const found = SECTIONS.find((s) => sectionSlug(s) === slug);
  return found ?? "Profile";
}

const PWD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PMO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A `YYYY-MM-DD` planned-for date as "Wed · Jun 17" (local calendar date, no timezone shift). */
export function fmtPlanned(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return `${PWD[date.getDay()]} · ${PMO[(m ?? 1) - 1]} ${d}`;
}

const Empty = ({ children }: { children?: Child }) => (
  <p class="muted" style="margin-top:0">
    {children}
  </p>
);

const RecipeLink = ({ slug, title, small }: { slug: string; title: string | null; small?: boolean }) => (
  <>
    <a class={small ? "md-recipe-link sm" : "md-recipe-link"} href={`/admin/data/recipes/${encodeURIComponent(slug)}`}>
      {title ?? slug}
    </a>
    {!small ? <span class="rslug">{slug}</span> : null}
  </>
);

const ProfileSection = ({ profile }: { profile: MemberDetailData["profile"] }) => (
  <div class="card">
    <section>
      <PrettyKV obj={profile as unknown as Record<string, unknown>} />
    </section>
  </div>
);

const PantrySection = ({ pantry }: { pantry: MemberDetailData["pantry"] }) =>
  pantry.length === 0 ? (
    <Empty>Pantry is empty.</Empty>
  ) : (
    <DataTable
      columns={[
        "name",
        { key: "quantity", label: "Qty", align: "right" },
        { key: "category", label: "Category" },
        { key: "prepared_from", label: "Prepared from" },
        { key: "last_verified_at", label: "Last verified", align: "right" },
      ]}
      rows={pantry.map((p) => ({
        name: String(p.name ?? ""),
        quantity: String(p.quantity ?? ""),
        category: p.category ? <span class="rfacet">{String(p.category)}</span> : <span class="pv-null">—</span>,
        prepared_from: p.prepared_from ? <span class="md-prep">{String(p.prepared_from)}</span> : <span class="pv-null">—</span>,
        last_verified_at: <span class="muted small">{p.last_verified_at ? String(p.last_verified_at) : "—"}</span>,
      }))}
    />
  );

const MealPlanSection = ({
  mealPlan,
  titles,
}: {
  mealPlan: MemberDetailData["meal_plan"];
  titles: Map<string, string>;
}) =>
  mealPlan.length === 0 ? (
    <Empty>No meals planned.</Empty>
  ) : (
    <div class="md-plan">
      {mealPlan.map((p) => (
        <div class="md-plan-row">
          <span class="md-plan-day">
            {p.planned_for ? fmtPlanned(p.planned_for) : <span class="muted">Unscheduled</span>}
          </span>
          <span class="md-plan-recipe">
            <RecipeLink slug={p.recipe} title={titles.get(p.recipe) ?? null} />
          </span>
          {p.sides && p.sides.length > 0 ? <span class="md-plan-sides">+ {p.sides.join(", ")}</span> : null}
        </div>
      ))}
    </div>
  );

const GrocerySection = ({ grocery }: { grocery: MemberDetailData["grocery_list"] }) =>
  grocery.length === 0 ? (
    <Empty>Grocery list is empty.</Empty>
  ) : (
    <div class="md-grocery-list">
      {grocery.map((g) => (
        <div class="md-gitem">
          <span
            class={g.status === "in_cart" ? "md-gstatus in-cart" : "md-gstatus"}
            title={g.status === "in_cart" ? "in cart" : "active"}
          />
          <div class="md-gmain">
            <div class="md-gtop">
              <span class="md-gname">{g.name}</span>
              <span class="md-gqty muted small">{g.quantity}</span>
              {g.status === "in_cart" ? <span class="md-incart">in cart</span> : null}
            </div>
            <div class="md-gsub">
              <span class="rfacet md-gsrc">{g.source.replace("_", "-")}</span>
              {g.for_recipes.length > 0 ? (
                <span class="md-gfor muted small">
                  for{" "}
                  {g.for_recipes.map((s, i) => (
                    <>
                      {i > 0 ? ", " : ""}
                      <a class="md-recipe-link sm" href={`/admin/data/recipes/${encodeURIComponent(s)}`}>
                        {s}
                      </a>
                    </>
                  ))}
                </span>
              ) : null}
              {g.note ? <span class="md-gnote muted small">· {g.note}</span> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

const CookingLogSection = ({
  cookingLog,
  titles,
}: {
  cookingLog: MemberDetailData["cooking_log"];
  titles: Map<string, string>;
}) =>
  cookingLog.length === 0 ? (
    <Empty>No cooking history yet.</Empty>
  ) : (
    <DataTable
      columns={[
        "date",
        "dish",
        { key: "protein", label: "Protein" },
        { key: "cuisine", label: "Cuisine" },
        { key: "type", label: "Type", align: "right" },
      ]}
      rows={cookingLog.map((c) => {
        const recipe = typeof c.recipe === "string" ? c.recipe : null;
        const name = typeof c.name === "string" ? c.name : null;
        const type = typeof c.type === "string" ? c.type : "ad_hoc";
        return {
          date: <span class="muted small">{String(c.date ?? "")}</span>,
          dish: recipe ? (
            <span class="md-log-dish">
              <RecipeLink slug={recipe} title={titles.get(recipe) ?? null} small />
            </span>
          ) : (
            <span class="md-log-title">{name ?? "—"}</span>
          ),
          protein: c.protein ? <span class="rfacet">{String(c.protein)}</span> : <span class="pv-null">—</span>,
          cuisine: c.cuisine ? <span class="rfacet">{String(c.cuisine)}</span> : <span class="pv-null">—</span>,
          type: <span class={`md-type md-type-${type}`}>{type}</span>,
        };
      })}
    />
  );

const NotesSection = ({ id, notes }: { id: string; notes: MemberDetailData["recipe_notes"] }) =>
  notes.length === 0 ? (
    <Empty>@{id} hasn't written any recipe notes.</Empty>
  ) : (
    <div class="rd-notes">
      {notes.map((n) => {
        const tags: string[] = Array.isArray(n.tags) ? (n.tags as string[]) : [];
        return (
          <div class="rd-note">
            <div class="rd-note-head">
              <span class="md-note-recipe">{String(n.recipe ?? "")}</span>
              {n.private ? <Badge variant="outline">private</Badge> : null}
              {tags.map((t) => (
                <span class="rfacet">{t}</span>
              ))}
              <span class="rd-note-time muted small">{String(n.created_at ?? "")}</span>
            </div>
            <div class="rd-note-body">{String(n.body ?? "")}</div>
          </div>
        );
      })}
    </div>
  );

const SectionBody = ({
  section,
  detail,
  titles,
}: {
  section: Section;
  detail: MemberDetailData;
  titles: Map<string, string>;
}) => {
  switch (section) {
    case "Profile":
      return <ProfileSection profile={detail.profile} />;
    case "Pantry":
      return <PantrySection pantry={detail.pantry} />;
    case "Meal plan":
      return <MealPlanSection mealPlan={detail.meal_plan} titles={titles} />;
    case "Grocery":
      return <GrocerySection grocery={detail.grocery_list} />;
    case "Cooking log":
      return <CookingLogSection cookingLog={detail.cooking_log} titles={titles} />;
    case "Notes":
      return <NotesSection id={detail.id} notes={detail.recipe_notes} />;
    default:
      return null;
  }
};

const Header = ({ row }: { row: TenantRosterRow }) => (
  <div class="md-head">
    <div class="md-id">
      <span class="md-user">@{row.id}</span>
      {row.owner ? <Badge variant="secondary">owner</Badge> : null}
      {row.status === "active" ? <Badge variant="secondary">active</Badge> : <Badge variant="outline">pending</Badge>}
      {row.kroger === "linked" ? (
        <Badge variant="secondary">
          <LinkIcon size={11} /> kroger
        </Badge>
      ) : null}
    </div>
    {row.status === "active" ? (
      <div class="md-stats muted small">
        {row.cooked} recipes cooked · {row.favorites} favorites
        {row.joined != null ? ` · joined ${relAge(Date.now() - row.joined)}` : null}
      </div>
    ) : null}
  </div>
);

/** A pending (not-yet-connected) member's detail: just the header + an explanatory empty
 *  state — no sub-nav, no `memberDetail` read (there is nothing to read yet). */
export const PendingMemberDetailPage = ({ row }: { row: TenantRosterRow }) => (
  <Layout title={`@${row.id} · Members · grocery-agent admin`} active="/admin/members">
    <p>
      <a href="/admin/members">
        <ChevronLeftIcon size={15} /> All members
      </a>
    </p>
    <Header row={row} />
    <Empty>@{row.id} hasn't connected their Claude.ai yet — no profile or activity to show.</Empty>
  </Layout>
);

export const MemberDetailPage = ({
  row,
  detail,
  section,
  titles,
}: {
  row: TenantRosterRow;
  detail: MemberDetailData;
  section: Section;
  titles: Map<string, string>;
}) => (
  <Layout title={`@${row.id} · Members · grocery-agent admin`} active="/admin/members">
    <p>
      <a href="/admin/members">
        <ChevronLeftIcon size={15} /> All members
      </a>
    </p>
    <Header row={row} />
    <div class="data-nav">
      {SECTIONS.map((s) => (
        <a href={`/admin/members/${encodeURIComponent(row.id)}/${sectionSlug(s)}`} class={s === section ? "pill active" : "pill"}>
          {s}
        </a>
      ))}
    </div>
    <SectionBody section={section} detail={detail} titles={titles} />
  </Layout>
);
