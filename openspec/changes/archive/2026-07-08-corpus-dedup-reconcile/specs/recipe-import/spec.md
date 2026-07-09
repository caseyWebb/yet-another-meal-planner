## MODIFIED Requirements

### Requirement: Near-duplicate reconciliation without auto-merge

Near-duplicate recipes SHALL be surfaced for human review rather than merged automatically, by an **ongoing scheduled reconcile** over the whole corpus (the `recipe-dedup` capability) — not a one-time import pass. Detected pairs SHALL be reported as pending operator proposals carrying the pair and its evidence; both recipes SHALL be retained until a human decides, and no automated path SHALL merge, delete, or hide either recipe.

#### Scenario: Near-duplicates surfaced, not merged

- **WHEN** two recipes look like variants of the same dish (e.g. stovetop vs. pressure-cooker butter chicken)
- **THEN** both are retained and the pair is reported for the user to decide

#### Scenario: Pre-existing duplicates are eventually surfaced

- **WHEN** two near-duplicate recipes already coexist in the corpus (imported before any dedup ran)
- **THEN** the scheduled reconcile surfaces the pair as a pending operator proposal without either recipe being modified
