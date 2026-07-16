## MODIFIED Requirements

### Requirement: Cook-event type determines what is counted

Insights SHALL treat `cooking_log.type` as follows: a recipe's **times cooked** SHALL count only rows with `type='recipe'` whose `recipe` slug is present in the recipe index; the **cooking-activity heatmap** and the **Cook events** summary SHALL count rows with `type IN ('recipe','ad_hoc')`. Historical rows stored with the retired `type='ready_to_eat'` (no longer writable — `log_cooked` accepts only `recipe`/`ad_hoc`) SHALL NOT count toward cooking activity and SHALL NOT cause any Insights read to error — the counting math is unchanged from before the type's retirement.

#### Scenario: Ad-hoc cooking counts as activity but not toward a recipe

- **WHEN** a member logs an `ad_hoc` cook with no in-corpus recipe slug
- **THEN** it increments the heatmap day and the Cook events total, but does not add to any recipe's times-cooked

#### Scenario: Historical ready-to-eat rows are excluded from activity without error

- **WHEN** the aggregated logs contain historical rows stored with `type='ready_to_eat'`
- **THEN** those rows are not counted by the heatmap or the Cook events total — exactly as before the type's retirement — and the Insights area renders without error
