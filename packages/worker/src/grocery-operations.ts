import type { GroceryListData } from "@yamp/contract";
import type { Env } from "./env.js";
import { db } from "./db.js";
import { ToolError } from "./errors.js";
import { readGroceryList, markPantryVerifiedRows } from "./session-db.js";
import { readGrocerySnapshot } from "./grocery-snapshot.js";
import { purchaseAssertionStatements } from "./spend.js";
import { attributionSignature, readGroceryAttributionSignature } from "./to-buy.js";
import { ingredientContext } from "./corpus-db.js";
import { z } from "zod";
import { validateCanonicalId } from "./ingredient-normalize.js";

const Key = z.string().trim().min(1).max(240);
const SnapshotVersion = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const IsoTimestamp = z.string().datetime({ offset: true });
export const GroceryCheckedInputSchema = z.object({ key: Key, checked: z.boolean(), expected_row_version: z.number().int().nonnegative(), snapshot_version: SnapshotVersion, occurred_at: IsoTimestamp.optional() }).strict();
export const GroceryCoverageInputSchema = z.object({ key: Key, enabled: z.boolean(), name: z.string().trim().min(1).max(240).optional(), snapshot_version: SnapshotVersion }).strict();
export const GroceryVerifyInputSchema = z.object({ key: Key, snapshot_version: SnapshotVersion }).strict();
export const GrocerySubstitutionInputSchema = z.object({ original_key: Key, replacement_key: Key.optional(), replacement_name: z.string().trim().min(1).max(240).optional(), snapshot_version: SnapshotVersion, undo: z.boolean().optional() }).strict().superRefine((value, ctx) => { if (!value.undo && (!value.replacement_key || !value.replacement_name)) ctx.addIssue({ code: "custom", message: "replacement_key and replacement_name are required unless undo=true" }); });
export const GroceryRelistInputSchema = z.object({ send_id: Key.nullable(), line_key: Key, expected_row_version: z.number().int().positive() }).strict();
export const GroceryMarkPlacedInputSchema = z.object({ send_id: Key, expected_line_keys: z.array(Key).min(1).max(500).refine((keys) => new Set(keys).size === keys.length, "expected_line_keys must be unique"), snapshot_version: SnapshotVersion, occurred_at: IsoTimestamp.optional() }).strict();

export interface GroceryMutationResult { status: "ok"; snapshot: GroceryListData; outcome?: string }

function conflict(message: string, snapshot: GroceryListData): never {
  throw new ToolError("conflict", message, { snapshot });
}

async function requireSnapshot(env: Env, tenant: string, expected: string): Promise<GroceryListData> {
  const current = await readGrocerySnapshot(env, tenant);
  if (current.snapshot_version !== expected) conflict("The grocery list changed; review the current snapshot.", current);
  return current;
}

export async function setGroceryChecked(
  env: Env,
  tenant: string,
  input: { key: string; checked: boolean; expected_row_version: number; snapshot_version: string; occurred_at?: string },
): Promise<GroceryMutationResult> {
  const current = await readGrocerySnapshot(env, tenant);
  const rendered = current.lines.find((line) => line.key === input.key);
  const rows = await readGroceryList(env, tenant);
  const existing = rows.find((row) => row.normalized_name === input.key);
  const already = existing ? (existing.checked_at != null) === input.checked : !input.checked;
  if (already) return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant) };
  if (existing && (existing.row_version ?? 1) !== input.expected_row_version) {
    conflict("This grocery line changed on another device.", await readGrocerySnapshot(env, tenant));
  }
  if (!existing && !input.checked) return { status: "ok", snapshot: current };
  if (!existing && (!rendered || rendered.origin !== "plan")) {
    throw new ToolError("not_found", `No grocery line for canonical key: ${input.key}`, { key: input.key });
  }
  const occurred = input.occurred_at ?? new Date().toISOString();
  if (existing) {
    await db(env).run(
      "UPDATE grocery_list SET checked_at = ?1, row_version = row_version + 1, updated_at = ?2 " +
        "WHERE tenant = ?3 AND normalized_name = ?4 AND row_version = ?5",
      input.checked ? occurred : null,
      occurred,
      tenant,
      input.key,
      input.expected_row_version,
    );
  } else {
    await db(env).batch([
      db(env).prepare(
        "INSERT OR IGNORE INTO grocery_list (tenant,name,normalized_name,display_name,quantity,kind,domain,status,source,for_recipes,note,added_at,ordered_at,sent_in,checked_at,row_version,updated_at) " +
          "VALUES (?1,?2,?3,?4,?5,?6,?7,'active','menu',?8,?9,?10,NULL,NULL,?11,1,?11)",
        tenant,
        rendered!.name,
        input.key,
        rendered!.display_name ?? null,
        String(rendered!.quantity),
        rendered!.kind,
        rendered!.domain,
        JSON.stringify(rendered!.for_recipes),
        rendered!.note ?? null,
        occurred.slice(0, 10),
        occurred,
      ),
    ]);
  }
  const snapshot = await readGrocerySnapshot(env, tenant);
  const next = snapshot.lines.find((line) => line.key === input.key);
  if (!next || (next.checked_at != null) !== input.checked) conflict("This grocery line changed while checking it.", snapshot);
  return { status: "ok", snapshot, outcome: input.checked ? "checked" : "unchecked" };
}

export async function acceptGrocerySubstitution(
  env: Env,
  tenant: string,
  input: { original_key: string; replacement_key: string; replacement_name: string; snapshot_version: string },
): Promise<GroceryMutationResult> {
  if (input.replacement_key === input.original_key) {
    throw new ToolError("validation_failed", "A grocery substitution must use a different canonical key.");
  }
  const prior = await db(env).first<{ replacement_key: string; attribution_signature: string }>("SELECT replacement_key,attribution_signature FROM grocery_substitution_decisions WHERE tenant=?1 AND original_key=?2", tenant, input.original_key);
  const currentSignature = await readGroceryAttributionSignature(env, tenant, input.original_key);
  if (prior?.replacement_key === input.replacement_key && currentSignature === prior.attribution_signature) return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: "already substituted" };
  const current = await requireSnapshot(env, tenant, input.snapshot_version);
  const original = current.lines.find((line) => line.key === input.original_key);
  if (!original) throw new ToolError("not_found", "The original grocery line is no longer shopping state.");
  const ctx = await ingredientContext(env, { capture: false });
  if (!input.replacement_name.trim() || validateCanonicalId(input.replacement_key) !== input.replacement_key || !ctx.resolver.ids.has(input.replacement_key)) {
    throw new ToolError("validation_failed", "replacement_key must be a canonical live survivor; replacement_name is presentation only.");
  }
  const now = new Date().toISOString();
  const signature = attributionSignature({ for_recipes: original.for_recipes, recipe_attribution: original.recipe_attribution }); const token = crypto.randomUUID();
  const statements = [db(env).prepare(
    "INSERT INTO grocery_substitution_decisions (tenant,original_key,replacement_key,attribution_signature,created_replacement,replacement_version,row_version,created_at,updated_at,operation_token,ownership_token) " +
      "VALUES (?1,?2,?3,?4,0,NULL,1,?5,?5,?6,NULL) ON CONFLICT(tenant,original_key) DO UPDATE SET attribution_signature=excluded.attribution_signature,row_version=grocery_substitution_decisions.row_version+1,updated_at=excluded.updated_at,operation_token=excluded.operation_token " +
      "WHERE grocery_substitution_decisions.replacement_key=excluded.replacement_key",
    tenant, input.original_key, input.replacement_key, signature, now, token,
  )];
  statements.push(db(env).prepare(
    "UPDATE spend_events SET voided_at=?1 WHERE tenant=?2 AND line_key=?3 AND voided_at IS NULL " +
      "AND EXISTS (SELECT 1 FROM grocery_list WHERE tenant=?2 AND normalized_name=?3 AND status='ordered') " +
      "AND EXISTS (SELECT 1 FROM grocery_substitution_decisions WHERE tenant=?2 AND original_key=?4 AND operation_token=?5)",
    now, tenant, input.replacement_key, input.original_key, token,
  ));
  statements.push(db(env).prepare(
    "INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,note,added_at,ordered_at,sent_in,checked_at,row_version,updated_at,decision_owner_token) " +
      "SELECT ?1,?2,?3,?4,?5,?6,'active','menu',?7,NULL,?8,NULL,NULL,NULL,1,?9,?10 " +
      "WHERE EXISTS (SELECT 1 FROM grocery_substitution_decisions WHERE tenant=?1 AND original_key=?11 AND operation_token=?10) " +
      "ON CONFLICT(tenant,normalized_name) DO UPDATE SET status='active',ordered_at=NULL,sent_in=NULL," +
      "for_recipes=COALESCE((SELECT json_group_array(value) FROM (SELECT value FROM json_each(COALESCE(grocery_list.for_recipes,'[]')) UNION SELECT value FROM json_each(excluded.for_recipes) ORDER BY value)),'[]')," +
      "row_version=grocery_list.row_version+1,updated_at=excluded.updated_at",
    tenant, input.replacement_name, input.replacement_key, String(original.quantity), original.kind, original.domain, JSON.stringify(original.for_recipes), now.slice(0, 10), now, token, input.original_key,
  ));
  statements.push(db(env).prepare(
    "UPDATE grocery_substitution_decisions SET " +
      "ownership_token=(SELECT decision_owner_token FROM grocery_list WHERE tenant=?1 AND normalized_name=?2 AND decision_owner_token IN (COALESCE(grocery_substitution_decisions.ownership_token,''),?3))," +
      "created_replacement=CASE WHEN EXISTS (SELECT 1 FROM grocery_list WHERE tenant=?1 AND normalized_name=?2 AND decision_owner_token IN (COALESCE(grocery_substitution_decisions.ownership_token,''),?3)) THEN 1 ELSE 0 END," +
      "replacement_version=(SELECT row_version FROM grocery_list WHERE tenant=?1 AND normalized_name=?2 AND decision_owner_token IN (COALESCE(grocery_substitution_decisions.ownership_token,''),?3)) " +
      "WHERE tenant=?1 AND original_key=?4 AND operation_token=?3",
    tenant, input.replacement_key, token, input.original_key,
  ));
  await db(env).batch(statements);
  const claimed = await db(env).first<{ replacement_key: string; attribution_signature: string; operation_token: string | null }>("SELECT replacement_key,attribution_signature,operation_token FROM grocery_substitution_decisions WHERE tenant=?1 AND original_key=?2", tenant, input.original_key);
  if (claimed?.operation_token !== token && (claimed?.replacement_key !== input.replacement_key || claimed.attribution_signature !== signature)) conflict("A different substitution was accepted concurrently.", await readGrocerySnapshot(env, tenant));
  return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: "substituted" };
}

export async function undoGrocerySubstitution(
  env: Env,
  tenant: string,
  input: { original_key: string; snapshot_version: string },
): Promise<GroceryMutationResult> {
  const decision = await db(env).first<{ replacement_key: string; created_replacement: number; replacement_version: number | null; row_version: number; operation_token: string | null; ownership_token: string | null }>(
    "SELECT replacement_key,created_replacement,replacement_version,row_version,operation_token,ownership_token FROM grocery_substitution_decisions WHERE tenant=?1 AND original_key=?2",
    tenant, input.original_key,
  );
  if (!decision) return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant) };
  await requireSnapshot(env, tenant, input.snapshot_version);
  const claim = crypto.randomUUID();
  const stmts = [db(env).prepare(
    "UPDATE grocery_substitution_decisions SET operation_token=?1 WHERE tenant=?2 AND original_key=?3 AND row_version=?4 AND operation_token IS ?5",
    claim, tenant, input.original_key, decision.row_version, decision.operation_token,
  )];
  let outcome = "original restored; replacement preserved";
  if (decision.created_replacement && decision.replacement_version != null && decision.ownership_token) {
    stmts.push(db(env).prepare(
      "DELETE FROM grocery_list WHERE tenant=?1 AND normalized_name=?2 AND row_version=?3 AND decision_owner_token=?4 " +
        "AND EXISTS (SELECT 1 FROM grocery_substitution_decisions WHERE tenant=?1 AND original_key=?5 AND operation_token=?6)",
      tenant, decision.replacement_key, decision.replacement_version, decision.ownership_token, input.original_key, claim,
    ));
    outcome = "original restored; untouched replacement removed";
  }
  stmts.push(db(env).prepare("DELETE FROM grocery_substitution_decisions WHERE tenant=?1 AND original_key=?2 AND operation_token=?3", tenant, input.original_key, claim));
  await db(env).batch(stmts);
  const survivorDecision = await db(env).first<{ row_version: number }>("SELECT row_version FROM grocery_substitution_decisions WHERE tenant=?1 AND original_key=?2", tenant, input.original_key);
  if (survivorDecision) conflict("The substitution changed while Undo was applying.", await readGrocerySnapshot(env, tenant));
  if (decision.created_replacement && decision.replacement_version != null && decision.ownership_token) {
    const survivor = await db(env).first<{ row_version: number }>("SELECT row_version FROM grocery_list WHERE tenant=?1 AND normalized_name=?2", tenant, decision.replacement_key);
    if (survivor) outcome = "original restored; replacement preserved";
  }
  return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome };
}

export async function setGroceryBuyAnyway(
  env: Env,
  tenant: string,
  input: { key: string; enabled: boolean; name?: string; snapshot_version: string },
): Promise<GroceryMutationResult> {
  const decision = await db(env).first<{ created_row: number; created_row_version: number | null; row_version: number; operation_token: string | null; ownership_token: string | null }>(
    "SELECT created_row,created_row_version,row_version,operation_token,ownership_token FROM grocery_coverage_decisions WHERE tenant=?1 AND line_key=?2", tenant, input.key,
  );
  if ((input.enabled && decision) || (!input.enabled && !decision)) return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: input.enabled ? "already buy anyway" : "already undone" };
  const current = await requireSnapshot(env, tenant, input.snapshot_version);
  const covered = current.pantry_covered.find((line) => line.key === input.key);
  if (!input.enabled) {
    if (!decision) return { status: "ok", snapshot: current, outcome: "already undone" };
    const claim = crypto.randomUUID();
    const stmts = [db(env).prepare(
      "UPDATE grocery_coverage_decisions SET operation_token=?1 WHERE tenant=?2 AND line_key=?3 AND row_version=?4 AND operation_token IS ?5",
      claim, tenant, input.key, decision.row_version, decision.operation_token,
    )];
    if (decision.created_row && decision.created_row_version != null && decision.ownership_token) stmts.push(db(env).prepare(
      "DELETE FROM grocery_list WHERE tenant=?1 AND normalized_name=?2 AND row_version=?3 AND decision_owner_token=?4 " +
        "AND EXISTS (SELECT 1 FROM grocery_coverage_decisions WHERE tenant=?1 AND line_key=?2 AND operation_token=?5)",
      tenant, input.key, decision.created_row_version, decision.ownership_token, claim,
    ));
    stmts.push(db(env).prepare("DELETE FROM grocery_coverage_decisions WHERE tenant=?1 AND line_key=?2 AND operation_token=?3", tenant, input.key, claim));
    await db(env).batch(stmts);
    const survivor = await db(env).first<{ row_version: number }>("SELECT row_version FROM grocery_coverage_decisions WHERE tenant=?1 AND line_key=?2", tenant, input.key);
    if (survivor) conflict("The pantry decision changed while Undo was applying.", await readGrocerySnapshot(env, tenant));
    return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: "buy-anyway undone" };
  }
  if (!covered) throw new ToolError("not_found", "The pantry no longer covers this grocery line.");
  const now = new Date().toISOString(); const token = crypto.randomUUID();
  const stmts = [db(env).prepare(
    "INSERT INTO grocery_coverage_decisions (tenant,line_key,created_row,created_row_version,row_version,created_at,updated_at,operation_token,ownership_token) VALUES (?1,?2,0,NULL,1,?3,?3,?4,NULL) " +
      "ON CONFLICT(tenant,line_key) DO UPDATE SET operation_token=excluded.operation_token WHERE grocery_coverage_decisions.line_key=excluded.line_key",
    tenant, input.key, now, token,
  )];
  stmts.push(db(env).prepare(
    "UPDATE spend_events SET voided_at=?1 WHERE tenant=?2 AND line_key=?3 AND voided_at IS NULL " +
      "AND EXISTS (SELECT 1 FROM grocery_list WHERE tenant=?2 AND normalized_name=?3 AND status='ordered') " +
      "AND EXISTS (SELECT 1 FROM grocery_coverage_decisions WHERE tenant=?2 AND line_key=?3 AND operation_token=?4)",
    now, tenant, input.key, token,
  ));
  stmts.push(db(env).prepare(
    "INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,note,added_at,ordered_at,sent_in,checked_at,row_version,updated_at,decision_owner_token) " +
      "SELECT ?1,?2,?3,'1','grocery','grocery','active','pantry_low',?4,'Bought despite pantry coverage',?5,NULL,NULL,NULL,1,?6,?7 " +
      "WHERE EXISTS (SELECT 1 FROM grocery_coverage_decisions WHERE tenant=?1 AND line_key=?3 AND operation_token=?7) " +
      "ON CONFLICT(tenant,normalized_name) DO UPDATE SET status='active',ordered_at=NULL,sent_in=NULL," +
      "for_recipes=COALESCE((SELECT json_group_array(value) FROM (SELECT value FROM json_each(COALESCE(grocery_list.for_recipes,'[]')) UNION SELECT value FROM json_each(excluded.for_recipes) ORDER BY value)),'[]')," +
      "row_version=grocery_list.row_version+1,updated_at=excluded.updated_at",
    tenant, covered.display_name ?? covered.name, input.key, JSON.stringify(covered.for_recipes), now.slice(0, 10), now, token,
  ));
  stmts.push(db(env).prepare(
    "UPDATE grocery_coverage_decisions SET " +
      "ownership_token=(SELECT decision_owner_token FROM grocery_list WHERE tenant=?1 AND normalized_name=?2 AND decision_owner_token IN (COALESCE(grocery_coverage_decisions.ownership_token,''),?3))," +
      "created_row=CASE WHEN EXISTS (SELECT 1 FROM grocery_list WHERE tenant=?1 AND normalized_name=?2 AND decision_owner_token IN (COALESCE(grocery_coverage_decisions.ownership_token,''),?3)) THEN 1 ELSE 0 END," +
      "created_row_version=(SELECT row_version FROM grocery_list WHERE tenant=?1 AND normalized_name=?2 AND decision_owner_token IN (COALESCE(grocery_coverage_decisions.ownership_token,''),?3)) " +
      "WHERE tenant=?1 AND line_key=?2 AND operation_token=?3",
    tenant, input.key, token,
  ));
  await db(env).batch(stmts);
  return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: "buy anyway" };
}

export async function verifyGroceryPantry(
  env: Env, tenant: string, input: { key: string; snapshot_version: string },
): Promise<GroceryMutationResult> {
  await requireSnapshot(env, tenant, input.snapshot_version);
  const result = await markPantryVerifiedRows(env, tenant, [input.key], new Date().toISOString().slice(0, 10));
  if (result.missing.length) throw new ToolError("not_found", "That pantry item no longer exists.", { key: input.key });
  return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: "still good" };
}

export async function relistGrocerySendLine(
  env: Env,
  tenant: string,
  input: { send_id: string | null; line_key: string; expected_row_version: number },
): Promise<GroceryMutationResult> {
  const row = await db(env).first<{ status: string; sent_in: string | null; row_version: number }>(
    "SELECT status,sent_in,row_version FROM grocery_list WHERE tenant=?1 AND normalized_name=?2",
    tenant, input.line_key,
  );
  if (!row) throw new ToolError("not_found", "The grocery line no longer exists.");
  const before = await readGrocerySnapshot(env, tenant);
  if (row.status === "active" && row.sent_in == null) return { status: "ok", snapshot: before, outcome: "already relisted" };
  const openLink = row.sent_in == null
    ? null
    : await db(env).first<{ id: string }>(
      "SELECT s.id FROM order_sends s JOIN order_send_lines l ON l.send_id=s.id AND l.line_key=?3 " +
        "WHERE s.tenant=?1 AND s.id=?2 AND s.placed_at IS NULL",
      tenant, row.sent_in, input.line_key,
    );
  const linkageMatches = input.send_id === null
    ? openLink == null
    : row.sent_in === input.send_id && openLink != null;
  if (row.status !== "in_cart" || !linkageMatches || row.row_version !== input.expected_row_version) {
    conflict("The send membership changed; review the current cart group.", before);
  }
  const now = new Date().toISOString();
  const result = input.send_id === null
    ? await db(env).run(
      "UPDATE grocery_list SET status='active', sent_in=NULL, row_version=row_version+1, updated_at=?1 " +
        "WHERE tenant=?2 AND normalized_name=?3 AND status='in_cart' AND row_version=?4 " +
        "AND (sent_in IS NULL OR NOT EXISTS (SELECT 1 FROM order_sends s JOIN order_send_lines l ON l.send_id=s.id " +
        "WHERE s.tenant=?2 AND s.id=grocery_list.sent_in AND s.placed_at IS NULL AND l.line_key=grocery_list.normalized_name))",
      now, tenant, input.line_key, input.expected_row_version,
    )
    : await db(env).run(
      "UPDATE grocery_list SET status='active', sent_in=NULL, row_version=row_version+1, updated_at=?1 " +
        "WHERE tenant=?2 AND normalized_name=?3 AND status='in_cart' AND sent_in=?4 AND row_version=?5 " +
        "AND EXISTS (SELECT 1 FROM order_sends WHERE tenant=?2 AND id=?4 AND placed_at IS NULL)",
      now, tenant, input.line_key, input.send_id, input.expected_row_version,
    );
  if (result.changes !== 1) conflict("The send membership changed while relisting.", await readGrocerySnapshot(env, tenant));
  return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: "back to list" };
}

export async function markGrocerySendPlaced(
  env: Env,
  tenant: string,
  input: { send_id: string; expected_line_keys: string[]; snapshot_version: string; occurred_at?: string },
): Promise<GroceryMutationResult> {
  const send = await db(env).first<{ placed_at: string | null }>(
    "SELECT placed_at FROM order_sends WHERE tenant=?1 AND id=?2", tenant, input.send_id,
  );
  if (!send) throw new ToolError("not_found", "That send does not belong to this household.");
  if (send.placed_at) return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: `placed ${send.placed_at}` };
  const current = await readGrocerySnapshot(env, tenant);
  if (current.snapshot_version !== input.snapshot_version) conflict("The grocery list changed before placement.", current);
  const members = await db(env).all<{ normalized_name: string }>(
    "SELECT normalized_name FROM grocery_list WHERE tenant=?1 AND status='in_cart' AND sent_in=?2 ORDER BY normalized_name",
    tenant, input.send_id,
  );
  const actual = members.map((row) => row.normalized_name);
  const expected = [...new Set(input.expected_line_keys)].sort();
  if (actual.length === 0) throw new ToolError("validation_failed", "A send with zero current lines cannot be placed.");
  if (JSON.stringify(actual) !== JSON.stringify(expected)) conflict("The send's line membership changed.", await readGrocerySnapshot(env, tenant));
  const occurred = input.occurred_at ?? new Date().toISOString();
  const occurredDay = occurred.slice(0, 10);
  const token = crypto.randomUUID();
  const spend = await purchaseAssertionStatements(
    env, tenant, actual.map((lineKey) => ({ sendId: input.send_id, lineKey })), occurredDay, { placementToken: token },
  );
  const placeholders = expected.map((_, index) => `?${index + 6}`).join(",");
  const statements: D1PreparedStatement[] = [db(env).prepare(
    "UPDATE order_sends SET placed_at=?1, placement_token=?2 WHERE tenant=?3 AND id=?4 AND placed_at IS NULL " +
      "AND (SELECT COUNT(*) FROM grocery_list WHERE tenant=?3 AND status='in_cart' AND sent_in=?4)=?5 " +
      `AND NOT EXISTS (SELECT 1 FROM grocery_list WHERE tenant=?3 AND status='in_cart' AND sent_in=?4 AND normalized_name NOT IN (${placeholders}))`,
    occurred, token, tenant, input.send_id, expected.length, ...expected,
  )];
  statements.push(...actual.map((key) => db(env).prepare(
    "UPDATE grocery_list SET status='ordered', ordered_at=?1, row_version=row_version+1, updated_at=?2 " +
      "WHERE tenant=?3 AND normalized_name=?4 AND status='in_cart' AND sent_in=?5 " +
      "AND EXISTS (SELECT 1 FROM order_sends WHERE tenant=?3 AND id=?5 AND placement_token=?6)",
    occurredDay, occurred, tenant, key, input.send_id, token,
  )));
  statements.push(...spend.statements);
  await db(env).batch(statements);
  const claimed = await db(env).first<{ placement_token: string | null; placed_at: string | null }>("SELECT placement_token,placed_at FROM order_sends WHERE tenant=?1 AND id=?2", tenant, input.send_id);
  if (claimed?.placement_token !== token) {
    const fresh = await readGrocerySnapshot(env, tenant);
    if (claimed?.placed_at) return { status: "ok", snapshot: fresh, outcome: `placed ${claimed.placed_at}` };
    conflict("The send membership changed during placement.", fresh);
  }
  const verifyPlaceholders = actual.map((_, index) => `?${index + 3}`).join(",");
  const verified = await db(env).first<{ count: number }>(`SELECT COUNT(*) AS count FROM grocery_list WHERE tenant=?1 AND sent_in=?2 AND status='ordered' AND normalized_name IN (${verifyPlaceholders})`, tenant, input.send_id, ...actual);
  if (verified?.count !== actual.length) throw new ToolError("storage_error", "The send placement transaction did not advance every claimed line.");
  return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: `placed ${actual.length} lines` };
}
