# Spike: discovery-sweep recipe classifier

Answers the **gating** question for the `background-discovery-sweep` OpenSpec change (task 0):
*can a small Workers AI model classify raw recipe content into valid, accurate frontmatter
facets, unattended, well enough to auto-import?*

This is the load-bearing risk of moving discovery to a background cron — the classification
that the frontier model does in-chat today would run on a small model with no human to catch
a bad call. The full design rationale + recorded runs live in
`openspec/changes/background-discovery-sweep/design.md` (Decision 7).

## What it does

- `prompt.mjs` — the candidate production classifier prompt (facets only; `description`
  stays the existing tuned `generateDescription`). Vocab is injected from `src/vocab.js` so
  the prompt can never drift from the gate.
- `eval-set.mjs` — 14 well-known recipes with hand-authored **gold** facets, curated to
  stress the silent-failure cases: vocab-mapping edges (shrimp→shellfish, multi-protein→
  mixed), `protein:null`/`cuisine:null`, off-vocab pressure (shakshuka, smoothie), the
  `season`/`requires_equipment` silent fields, the perishable test, and the sparse tail.
- `run.mjs` — classifies every recipe with each model, validates output against the **real**
  `src/recipe-contract.js`, and scores facets vs gold (exact on the gateable/silent fields,
  F1 on the fuzzy ones). Prints per-model aggregates + every validity failure and silent miss.

## Run it

```bash
CLOUDFLARE_API_TOKEN=... node scripts/spike-discovery-classify/run.mjs
# optional: MODELS="@cf/mistralai/mistral-small-3.1-24b-instruct,..." CF_ACCOUNT_ID=...
```

(Calls the Workers AI REST API directly, mirroring how `env.AI.run` would behave in the
Worker — Workers AI returns the JSON response already parsed.)

## Result (live, 14-recipe eval)

| metric | mistral-small-3.1-24b | llama-3.3-70b | llama-3.1-8b-fast |
| --- | --- | --- | --- |
| contract-valid (loud) | **14/14 (100%)** | 13/14 | 10/14 (71%) |
| protein / cuisine | 86% / 93% | 93% / 100% | 79% / 93% |
| season / equipment (silent) | 93% / 100% | 93% / 100% | 43% / 100% |

**Verdict: viable on `mistral-small-3.1-24b`** (already the bound `DESC_MODEL`). The contract
validator is the hard backstop; the 8b is disqualified (it leaks off-vocab values despite the
vocab being in the prompt — a capable model AND the gate are both required). `season` is the
only real silent risk and the Run-2 prompt (hard `[]` floor + a year-round exemplar) biased
its residual error to the safe *under*-tag direction. τ/δ (taste + dedup cosine thresholds)
are calibrated separately against the live corpus — lower-risk, not gating.
