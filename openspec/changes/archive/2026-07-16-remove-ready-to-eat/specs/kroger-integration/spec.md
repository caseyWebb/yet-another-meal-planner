## REMOVED Requirements

### Requirement: ready_to_eat_available by curbside/delivery fulfillment

**Reason**: The ready-to-eat surface is removed wholesale ("ready to eat infra can probably be ripped entirely, it needs to be rethought"). With the per-tenant catalog no longer readable or writable through any tool, an availability cross-reference over it has nothing to serve; the tool is unregistered outright, with no alias or stub.
**Migration**: None for callers — buy-time price/availability questions go through the retained `kroger_prices` / `kroger_flyer` reads. The D1 `ready_to_eat` table stays in place untouched pending a future rethink. The shared `flyer_terms` table is unaffected: it remains the operator-curated broad-scan-term set driving the background flyer warm; any RTE-flavored terms an operator added remain valid generic scan terms and may be pruned via the admin Config editor at the operator's discretion.
