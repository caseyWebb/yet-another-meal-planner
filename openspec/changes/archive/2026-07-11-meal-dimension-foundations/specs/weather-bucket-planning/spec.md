## ADDED Requirements

### Requirement: Weather-quota allocation is dinner-scoped

Weather-bucket quota allocation SHALL apply to **dinner slots only** (stories/02 Q4, resolved per product-specs Appendix A). Breakfast and lunch slots SHALL never carry a `weather_category` and SHALL never consume a weather-category quota: the non-dinner sampling passes see a neutral all-`mild` histogram, so the quota machinery degenerates cleanly to cadence-debt-only sampling rather than forking the code path. A `weather_affinity`/`weather_antipathy` stored on a non-dinner vibe SHALL be preserved on the row but be inert in allocation. (The archetype-derivation producer correspondingly discards weather-bucket labels for non-dinner clusters — the `meal-vibe-archetype-derivation` capability.)

#### Scenario: Non-dinner passes degenerate to a neutral histogram

- **WHEN** the engine shapes breakfast and lunch slots for a window whose forecast contains strong non-`mild` weather days
- **THEN** those passes allocate as if every day were `mild` — every breakfast/lunch slot is flex, none carries a `weather_category`, and no weather quota is consumed by them

#### Scenario: Dinner allocation is unchanged

- **WHEN** the engine shapes the dinner slots for the same window
- **THEN** the dinner pass histograms the window's per-day categories and allocates quotas exactly as before the meal dimension

#### Scenario: A stored non-dinner affinity is preserved but inert

- **WHEN** a lunch vibe carries a stored `weather_affinity`
- **THEN** the value remains on the row (nothing is stripped) and has no effect on lunch allocation or sampling weight
