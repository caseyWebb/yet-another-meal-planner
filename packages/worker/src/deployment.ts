// Deployment-level identity for member surfaces (connect-modal) and the visibility
// lens: the D9 deployment profile and the operator's public-facing config. The profile
// is read by the whoami response (src/api/session.ts) so the SPA can template setup
// copy and gate profile-dependent surfaces, and by every profile-conditioned Worker
// path (the lens, the trending guard, the curated sweep, the admin Config card) —
// never secrets, never per-tenant data.

import type { Env } from "./env.js";
import { db } from "./db.js";

/** The D9 deployment profiles. `self-hosted` treats the deployment as one implicit
 *  all-to-all friend graph (today's shared-corpus experience, byte-for-byte); `saas`
 *  scopes visibility to own/friend/curated grants. Long-lived configuration, not
 *  migration scaffolding. */
export type DeploymentProfile = "self-hosted" | "saas";

/**
 * Resolve the deployment profile. This accessor is the ONE site that names the
 * profile's source: the `deployment_profile` column on the `operator_config` D1
 * singleton (migration 0059 — the deployment-global config channel; a wrangler var is
 * deliberately NOT the channel: the operator deploy merge drops code-repo `vars`, and
 * a var would make the flip guards unenforceable). NULL/absent — including a missing
 * singleton row — resolves to `"self-hosted"`, so existing deployments need no
 * configuration or data change. An UNREADABLE table propagates its structured
 * `storage_error` (a SaaS deployment must never silently degrade to the wider
 * self-hosted lens on a D1 hiccup). Every profile-conditioned path (lens, trending
 * guard, curated sweep, whoami, admin) takes this value; no other site names the source.
 */
export async function loadDeploymentProfile(env: Env): Promise<DeploymentProfile> {
  const row = await db(env).first<{ deployment_profile: string | null }>(
    "SELECT deployment_profile FROM operator_config WHERE id = 1",
  );
  return row?.deployment_profile === "saas" ? "saas" : "self-hosted";
}

/** The operator identity the connect modal templates into its setup steps. */
export interface OperatorConfig {
  /** Display name for "updates {name} ships" copy. `OPERATOR_NAME`, falling back to
   *  `OWNER_TENANT_ID`; null when neither is set (copy degrades to "your operator"). */
  name: string | null;
  /** The plugin-marketplace repo slug (`<owner>/<data-repo>`). Stamped onto the deploy
   *  by data-deploy.yml from the calling data repo; null when unset (local dev). */
  repo: string | null;
}

/** Read the operator's public-facing config from the deployment vars. Unset values are
 *  explicit nulls — the modal degrades to generic copy, never a fabricated slug. */
export function operatorConfig(env: Env): OperatorConfig {
  const name = env.OPERATOR_NAME?.trim() || env.OWNER_TENANT_ID?.trim() || null;
  const repo = env.MARKETPLACE_REPO?.trim() || null;
  return { name, repo };
}
