// The Data explorer area (operator-data-explorer), server-rendered. Five read-only views over
// D1 + the R2 corpus — recipes, members, corpus, discovery, system — plus recipe/member detail.
// Everything the Elm version did with client state is plain SSR navigation here: the table tabs
// and the guidance browser ride query params (`?table=`, `?gprefix=`/`?gpath=`), detail rides
// path segments, and View Transitions animate the page swaps. No islands — it's all reads.
//
// Each route calls the same `src/admin-data.ts` reader the Elm app fetched, reusing its return
// types verbatim (no decoder). Heterogeneous rows/objects render as JSON, exactly as the Elm
// inspector did.

import type { Child } from "hono/jsx";
import { Hono } from "hono";
import { marked } from "marked";
import { Layout } from "../ui/layout.js";
import type { Env } from "../../env.js";
import { ToolError } from "../../errors.js";
import { resolveTenant, directoryFromEnv, kvTenantStore } from "../../tenant.js";
import {
  recipeList,
  recipeDetail,
  memberDetail,
  readTable,
  guidanceListing,
  guidanceObject,
  type RecipeDetail,
  type RecipeListEntry,
  type MemberDetail,
  type TablePage,
  type GuidanceListing,
} from "../../admin-data.js";

const VIEWS = [
  { slug: "recipes", label: "Recipes" },
  { slug: "members", label: "Members" },
  { slug: "corpus", label: "Corpus" },
  { slug: "discovery", label: "Discovery" },
  { slug: "system", label: "System" },
] as const;

const CORPUS_TABLES = ["aliases", "flyer_terms", "feeds", "stores", "store_notes", "sku_cache"];
const DISCOVERY_TABLES = ["discovery_candidates", "discovery_senders", "discovery_members", "discovery_rejections"];
const SYSTEM_TABLES = ["reconcile_errors", "bug_reports", "schema_meta"];

function pick(tables: string[], requested: string | undefined): string {
  return requested && tables.includes(requested) ? requested : tables[0];
}

function json(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function md(src: string): string {
  return marked.parse(src, { async: false });
}

// --- shell + shared bits -----------------------------------------------------

const DataShell = ({ active, children }: { active: string; children?: Child }) => (
  <Layout title="Data · grocery-agent admin" active="/admin/data" wide>
    <div class="data-nav">
      {VIEWS.map((v) => (
        <a href={`/admin/data/${v.slug}`} class={v.slug === active ? "pill active" : "pill"}>
          {v.label}
        </a>
      ))}
    </div>
    {children}
  </Layout>
);

const DataTable = ({ page }: { page: TablePage }) =>
  page.rows.length === 0 ? (
    <p class="muted">(No rows.)</p>
  ) : (
    <table>
      <thead>
        <tr>
          {page.columns.map((c) => (
            <th>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {page.rows.map((row) => (
          <tr>
            {page.columns.map((c) => (
              <td class="small">{cell(row[c])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

const TableTabs = ({ base, tables, active }: { base: string; tables: string[]; active: string }) => (
  <div class="data-nav">
    {tables.map((t) => (
      <a href={`${base}?table=${t}`} class={t === active ? "pill active" : "pill"}>
        {t}
      </a>
    ))}
  </div>
);

const JsonSection = ({ label, count, value }: { label: string; count?: number; value: unknown }) => (
  <div>
    <p class="schema-label">
      {label}
      {count != null ? <span class="muted small"> ({count})</span> : null}
    </p>
    {Array.isArray(value) && value.length === 0 ? <p class="muted">(none)</p> : <pre>{json(value)}</pre>}
  </div>
);

// --- recipes -----------------------------------------------------------------

const RecipesListPage = ({ recipes }: { recipes: RecipeListEntry[] }) => (
  <DataShell active="recipes">
    <h2>Recipes</h2>
    {recipes.length === 0 ? (
      <p class="muted">No recipes in the corpus or the index.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>slug</th>
            <th>status</th>
            <th>title</th>
          </tr>
        </thead>
        <tbody>
          {recipes.map((r) => (
            <tr>
              <td>
                <a href={`/admin/data/recipes/${encodeURIComponent(r.slug)}`}>{r.slug}</a>
              </td>
              <td>
                <span class={`tier ${r.status}`}>{r.status}</span>
              </td>
              <td class="small">{r.title ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </DataShell>
);

function tierDetail(d: RecipeDetail): string {
  switch (d.status) {
    case "indexed":
      return d.derived?.state === "described"
        ? "in R2 and the index; description generated"
        : "in R2 and the index; description not yet generated";
    case "skipped":
      return `in R2 but NOT indexed — ${d.reconcile_message ?? "(no reason)"}`;
    case "pending":
      return "in R2, not yet indexed (reconcile hasn't run)";
    case "orphaned":
      return "indexed but the R2 source is gone (stale projection)";
    default:
      return "";
  }
}

const RecipeDetailPage = ({ detail }: { detail: RecipeDetail }) => (
  <DataShell active="recipes">
    <p>
      <a href="/admin/data/recipes">← all recipes</a>
    </p>
    <h2>{detail.slug}</h2>
    <div class="card">
      <span class={`tier ${detail.status}`}>{detail.status}</span> <span class="muted small">{tierDetail(detail)}</span>
    </div>
    {detail.derived?.description ? (
      <div class="card">
        <p>{detail.derived.description}</p>
        <p class="muted small">{detail.derived.has_embedding ? "embedding: present" : "embedding: not yet generated"}</p>
      </div>
    ) : null}
    {detail.dispositions.length > 0 ? (
      <table>
        <thead>
          <tr>
            <th>tenant</th>
            <th>disposition</th>
          </tr>
        </thead>
        <tbody>
          {detail.dispositions.map((d) => (
            <tr>
              <td>{d.tenant}</td>
              <td>{d.favorite ? "favorite" : d.reject ? "reject" : "neutral"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : null}
    <JsonSection label="Notes (cross-tenant)" count={detail.notes.length} value={detail.notes} />
    {detail.body ? <div class="card" dangerouslySetInnerHTML={{ __html: md(detail.body) }} /> : null}
    <p class="schema-label">R2 source</p>
    {detail.source ? <pre>{detail.source}</pre> : <p class="muted">(no R2 source object)</p>}
    <p class="schema-label">D1 projection</p>
    {detail.projection ? <pre>{json(detail.projection)}</pre> : <p class="muted">(not in the index)</p>}
  </DataShell>
);

// --- members -----------------------------------------------------------------

const MembersListPage = ({ ids }: { ids: string[] }) => (
  <DataShell active="members">
    <h2>Members</h2>
    {ids.length === 0 ? (
      <p class="muted">No members yet.</p>
    ) : (
      <div class="data-nav">
        {ids.map((id) => (
          <a class="pill" href={`/admin/data/members/${encodeURIComponent(id)}`}>
            {id}
          </a>
        ))}
      </div>
    )}
  </DataShell>
);

const MemberDetailPage = ({ detail }: { detail: MemberDetail }) => (
  <DataShell active="members">
    <p>
      <a href="/admin/data/members">← all members</a>
    </p>
    <h2>{detail.id}</h2>
    <JsonSection label="Profile" value={detail.profile} />
    <JsonSection label="Pantry" value={detail.pantry} />
    <JsonSection label="Meal plan" value={detail.meal_plan} />
    <JsonSection label="Grocery list" value={detail.grocery_list} />
    <JsonSection label="Overlay (favorites / rejects)" count={detail.overlay.length} value={detail.overlay} />
    <JsonSection label="Cooking log" count={detail.cooking_log.length} value={detail.cooking_log} />
    <JsonSection label="Recipe notes (authored)" count={detail.recipe_notes.length} value={detail.recipe_notes} />
    <JsonSection label="Store notes (authored)" count={detail.store_notes.length} value={detail.store_notes} />
  </DataShell>
);

// --- corpus (lookup tables + guidance browser) -------------------------------

const CorpusPage = ({
  table,
  page,
  guidance,
}: {
  table: string;
  page: TablePage;
  guidance: GuidanceView;
}) => (
  <DataShell active="corpus">
    <h2>Shared corpus</h2>
    <p class="schema-label">Lookup tables</p>
    <TableTabs base="/admin/data/corpus" tables={CORPUS_TABLES} active={table} />
    <DataTable page={page} />
    <hr />
    <p class="schema-label">Guidance (R2 markdown)</p>
    <GuidanceBrowser view={guidance} />
  </DataShell>
);

type GuidanceView = { kind: "listing"; prefix: string; listing: GuidanceListing } | { kind: "object"; path: string; markdown: string };

const GuidanceBrowser = ({ view }: { view: GuidanceView }) =>
  view.kind === "object" ? (
    <div>
      <p>
        <a href="/admin/data/corpus">← back to guidance</a>
      </p>
      <p class="muted small">{view.path}</p>
      {view.markdown.trim() ? <div class="card" dangerouslySetInnerHTML={{ __html: md(view.markdown) }} /> : <p class="muted">(empty object)</p>}
    </div>
  ) : (
    <div>
      <p class="muted small">{view.prefix || "(root)"}</p>
      <ul class="tool-list">
        {view.listing.entries.map((e) =>
          e.type === "dir" ? (
            <li>
              <a class="tool-name" href={`/admin/data/corpus?gprefix=${encodeURIComponent(joinPrefix(view.prefix, e.name))}`}>
                📁 {e.name}
              </a>
            </li>
          ) : (
            <li>
              <a class="tool-name" href={`/admin/data/corpus?gpath=${encodeURIComponent(joinPrefix(view.prefix, e.name))}`}>
                {e.name}
              </a>
            </li>
          ),
        )}
      </ul>
    </div>
  );

function joinPrefix(prefix: string, name: string): string {
  return prefix ? `${prefix.replace(/\/$/, "")}/${name}` : name;
}

// --- generic table view (discovery / system) ---------------------------------

const TableViewPage = ({
  title,
  active,
  base,
  tables,
  table,
  page,
}: {
  title: string;
  active: string;
  base: string;
  tables: string[];
  table: string;
  page: TablePage;
}) => (
  <DataShell active={active}>
    <h2>{title}</h2>
    <TableTabs base={base} tables={tables} active={table} />
    <DataTable page={page} />
  </DataShell>
);

function html(node: { toString(): string }): string {
  return "<!doctype html>" + node.toString();
}

// --- route registration ------------------------------------------------------

export function registerDataRoutes(app: Hono<{ Bindings: Env }>): void {
  const recipesList = async (c: { env: Env }) => (await recipeList(c.env)).recipes;

  app.get("/data", async (c) => c.html(html(<RecipesListPage recipes={await recipesList(c)} />)));
  app.get("/data/recipes", async (c) => c.html(html(<RecipesListPage recipes={await recipesList(c)} />)));
  app.get("/data/recipes/:slug", async (c) => {
    const detail = await recipeDetail(c.env, decodeURIComponent(c.req.param("slug")));
    return c.html(html(<RecipeDetailPage detail={detail} />));
  });

  app.get("/data/members", async (c) => {
    const ids = [...(await kvTenantStore(c.env.TENANT_KV).list())].sort();
    return c.html(html(<MembersListPage ids={ids} />));
  });
  app.get("/data/members/:id", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const resolved = await resolveTenant(c.env, id, directoryFromEnv(c.env));
    if ("error" in resolved) throw new ToolError("not_found", resolved.message);
    return c.html(html(<MemberDetailPage detail={await memberDetail(c.env, resolved.id)} />));
  });

  app.get("/data/corpus", async (c) => {
    const table = pick(CORPUS_TABLES, c.req.query("table"));
    const page = await readTable(c.env, "corpus", table);
    const gpath = c.req.query("gpath");
    let guidance: GuidanceView;
    if (gpath) {
      const obj = await guidanceObject(c.env, gpath);
      guidance = { kind: "object", path: obj.key, markdown: obj.markdown };
    } else {
      const prefix = c.req.query("gprefix") ?? "";
      guidance = { kind: "listing", prefix, listing: await guidanceListing(c.env, prefix || undefined) };
    }
    return c.html(html(<CorpusPage table={table} page={page} guidance={guidance} />));
  });

  app.get("/data/discovery", async (c) => {
    const table = pick(DISCOVERY_TABLES, c.req.query("table"));
    const page = await readTable(c.env, "discovery", table);
    return c.html(html(<TableViewPage title="Discovery" active="discovery" base="/admin/data/discovery" tables={DISCOVERY_TABLES} table={table} page={page} />));
  });

  app.get("/data/system", async (c) => {
    const table = pick(SYSTEM_TABLES, c.req.query("table"));
    const page = await readTable(c.env, "system", table);
    return c.html(html(<TableViewPage title="System" active="system" base="/admin/data/system" tables={SYSTEM_TABLES} table={table} page={page} />));
  });
}

// Exported for unit tests (rendering the views with fixed data).
export { RecipesListPage, RecipeDetailPage, MembersListPage, MemberDetailPage, DataTable, tierDetail };
