// Profile-reconciliation tools (profile-reconciliation capability). Two audiences:
//   * MEMBER — `list_proposals` / `confirm_proposal`: read your pending profile-edit proposals
//     and accept (apply the diff) or reject (recorded, never re-surfaced). Either surface (chat
//     or web app) sees the same queue.
//   * OPERATOR — `reconcile_read_signals` / `reconcile_enqueue_proposal`: read the cross-member
//     reconcile signals and enqueue richer proposals, driven from the operator's own (frontier)
//     Claude. Gated on `isOperator` (the caller's tenant == env.OWNER_TENANT_ID), consistent
//     with the operator's existing cross-tenant trust (the admin Data explorer). A member
//     confirmation is still required to apply any operator-enqueued change.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { normalizeTenantId, directoryFromEnv, type Tenant } from "./tenant.js";
import { runTool, ToolError } from "./errors.js";
import { readNightVibes, readVibeLastSatisfied } from "./night-vibe-db.js";
import { draftProposals, type ProposalDraft } from "./reconcile-signals.js";
import { readProposals, getProposal, enqueueProposal, setProposalStatus, applyProposal } from "./reconcile-db.js";

/** The caller's tenant is the operator iff it matches the configured OWNER_TENANT_ID. */
function isOperator(env: Env, tenant: Tenant): boolean {
  return !!env.OWNER_TENANT_ID && normalizeTenantId(env.OWNER_TENANT_ID) === tenant.id;
}

/** What resolving a proposal yields: the recorded status, plus what applying changed on accept. */
export type ResolveProposalResult =
  | { id: string; status: "accepted"; applied: string }
  | { id: string; status: "rejected" };

/**
 * The `confirm_proposal` core as a shared operation (member-app-core D2): scope the
 * proposal to the caller, apply-on-accept (`applyProposal` + status) or record the
 * reject. Unknown id → structured `not_found`; an ALREADY-RESOLVED proposal →
 * structured `conflict` (D8: a replayed confirm is answered as converged, never
 * re-applied). Called by the MCP tool and the member API's
 * `POST /api/vibes/proposals/:id/confirm`.
 */
export async function resolveProposal(
  env: Env,
  tenant: string,
  id: string,
  accept: boolean,
): Promise<ResolveProposalResult> {
  const proposal = await getProposal(env, id, tenant);
  if (!proposal) throw new ToolError("not_found", `no proposal '${id}'`, { id });
  if (proposal.status !== "pending") {
    throw new ToolError("conflict", `proposal '${id}' is already ${proposal.status}`, {
      id,
      status: proposal.status,
    });
  }
  const nowIso = new Date().toISOString();
  if (accept) {
    const applied = await applyProposal(env, tenant, proposal, nowIso);
    await setProposalStatus(env, id, tenant, "accepted", nowIso);
    return { id, status: "accepted", applied };
  }
  await setProposalStatus(env, id, tenant, "rejected", nowIso);
  return { id, status: "rejected" };
}

export function registerReconcileTools(server: McpServer, env: Env, tenant: Tenant): void {
  // --- member surface -------------------------------------------------------

  server.registerTool(
    "list_proposals",
    {
      description:
        "List the caller's PENDING profile-reconciliation proposals — suggested profile edits (e.g. prune a night vibe you never cook, stretch a cadence you keep deferring) that reconcile your stated palette against what you actually cook. Read-only; confirm with confirm_proposal. Returns { proposals: [{ id, kind, target, rationale, payload, evidence, producer }] }.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const proposals = await readProposals(env, tenant.id, "pending");
        return { proposals };
      }),
  );

  server.registerTool(
    "confirm_proposal",
    {
      description:
        "Confirm a profile-reconciliation proposal by id. `accept: true` applies its diff to your palette (prune/adjust/add a night vibe) and marks it accepted; `accept: false` rejects it (recorded as a signal — the same proposal is never re-surfaced). Unknown id → not_found; an already-resolved id → conflict (nothing changes — the earlier resolution stands). Returns { id, status, applied? }.",
      inputSchema: { id: z.string().min(1), accept: z.boolean() },
    },
    ({ id, accept }) => runTool(() => resolveProposal(env, tenant.id, id, accept)),
  );

  // --- operator surface (cross-tenant; gated on OWNER_TENANT_ID) -------------

  server.registerTool(
    "reconcile_read_signals",
    {
      description:
        "OPERATOR-ONLY. Read the deterministic profile-reconciliation signals across ALL members — each member's palette size and drafted cadence signals (stale-ignored vibes, chronically-deferred cadences) — so the operator's own Claude can reason over the group and enqueue richer proposals (reconcile_enqueue_proposal). Non-operators get insufficient_permission. Returns { members: [{ tenant, palette_size, signals }] }.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        if (!isOperator(env, tenant)) throw new ToolError("insufficient_permission", "reconcile_read_signals is operator-only");
        const tenants = await directoryFromEnv(env).list();
        const now = new Date();
        const members = [];
        for (const t of tenants) {
          const [palette, last] = await Promise.all([readNightVibes(env, t), readVibeLastSatisfied(env, t)]);
          members.push({ tenant: t, palette_size: palette.length, signals: draftProposals(palette, last, now) });
        }
        return { members };
      }),
  );

  server.registerTool(
    "reconcile_enqueue_proposal",
    {
      description:
        "OPERATOR-ONLY. Enqueue a profile-reconciliation proposal for a member (the operator-frontier producer). The member still confirms it via confirm_proposal before anything changes. `kind` ∈ add_vibe | adjust_cadence | prune_vibe; `payload` is the proposed diff; `target` is the vibe id. Idempotent by (tenant, kind, target). Non-operators get insufficient_permission. Returns { id, enqueued }.",
      inputSchema: {
        tenant: z.string().min(1),
        kind: z.enum(["add_vibe", "adjust_cadence", "prune_vibe"]),
        target: z.string().min(1),
        payload: z.record(z.string(), z.unknown()),
        rationale: z.string().min(1),
        evidence: z.record(z.string(), z.unknown()).optional(),
      },
    },
    ({ tenant: target_tenant, kind, target, payload, rationale, evidence }) =>
      runTool(async () => {
        if (!isOperator(env, tenant)) throw new ToolError("insufficient_permission", "reconcile_enqueue_proposal is operator-only");
        const draft: ProposalDraft = { kind, target, payload, rationale, evidence: evidence ?? {} };
        const { id, inserted } = await enqueueProposal(env, normalizeTenantId(target_tenant), draft, "operator", new Date().toISOString());
        return { id, enqueued: inserted };
      }),
  );
}
