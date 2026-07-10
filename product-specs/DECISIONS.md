# Decision log

Authoritative product decisions for this spec set, in chronological order. A page/story
spec that conflicts with an entry here is stale — this file wins. Entries marked
**(ratify)** are recommendations awaiting the operator's confirmation; everything else is
decided.

## 2026-07-10 — operator steers (session 1)

- **D1. Tenant = household.** Tenants optionally hold multiple member accounts;
  friendships are tenant-to-tenant links. (stories/01)
- **D2. Visibility lenses over one corpus; dedup + memoize everything.** Recipe
  visibility is an overlay, never segmentation. Any processed artifact (fetch, parse,
  facet derivation, embeddings, match caches, feed polls) is identity-keyed and computed
  once. (stories/01)
- **D3. Empty corpus on join.** No inherited corpus for a new household; friend links
  and a small product-maintained public curated set cushion the cold start. (stories/01)
- **D4. Widgets are dual-use MCP Apps.** One component, two hosts (member app + Claude
  conversations); in the MCP App host every mutating interaction must send updated
  context to the agent via the MCP Apps protocol — silent backend writes that the agent
  never sees are state-divergence bugs. (stories/06)

## 2026-07-10 — operator steers (session 1, grilling round)

- **D5. Mock data mechanics are painted-door.** The mockup's hardcoded data, selection
  logic, and unwired states demonstrate the experience, not the mechanism. Specs cite
  them as UX contracts only; real sourcing comes from the repo's existing derivation
  doctrine.
- **D6. "Offline" store adapters are a rename, not a new entity.** They are the existing
  generic non-Kroger stores surface (`list_stores` / `add_store` / store notes, incl.
  the `layout` aisle notes). The Preferences card re-surfaces that data with the aisle-map
  editor; no parallel store table.
- **D7. Instacart is genuinely new** — new integration, feasibility spike before its
  proposal. (stories/04)
- **D8. The UX cuts are deliberate and final.** Cut from the member app: slot lock +
  exclude, adventurousness dial, protein wants, freeform propose phrase, global reroll,
  the propose weather strip, lunch strategy pref, ready-to-eat default-action pref, the
  standalone vibe reconciliation queue (inline suggestions replace it), the manual
  "Suggest from your cooking" trigger, and member-app surfacing of `merge_recipes`
  proposals (they remain agent-side). Where a cut contradicts an existing spec
  (`member-app-propose` weather strip), the band that lands the surface updates that spec
  in the same change — deltas, not silent drift. Where a cut removes a preference
  (`lunch strategy`, RTE action), its proposal defines the migration onto meal vibes.

- **D9. Deployment profiles (long-term feature flags): "self-hosted" and "SaaS".**
  The **self-hosted** profile hides the friends functionality and makes everyone in the
  deployment friends by default — an implicit all-to-all graph. Because visibility is a
  lens (D2), implicit universal friendship reduces exactly to today's shared-corpus
  experience: self-hosters see no change beyond gaining household members. The **SaaS**
  profile enables the full friends surface, empty-corpus-on-join, and the curated set.
  Profiles are deployment configuration, not migration scaffolding — they live
  indefinitely. Consequences: no tenant/corpus data surgery for existing deployments;
  the People page renders household-only under self-hosted; "Popular with Friends" reads
  the friend lens in both profiles (under self-hosted it equals deployment-wide trending,
  so no relabel is needed); empty-corpus-on-join and the curated set apply to the SaaS
  profile only.
