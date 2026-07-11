## ADDED Requirements

### Requirement: Sidebar badge counts are derived once from the area reads

The app shell's sidebar SHALL derive its nav badge counts from one shared derivation so a
badge and the page it mirrors can never disagree. The meal-plan badge SHALL count
schedulable meal rows only, excluding project rows (`meal: 'project'`). The grocery badge
SHALL be the derived to-buy line count — the same derivation the grocery page renders —
so rows already advanced to `in_cart` or `ordered` are excluded and plan-derived needs are
included. A count of zero SHALL render no badge. The people badge (pending inbound
requests) is reserved for the People destination and is not rendered until it ships; the
mock's friend-count badge is a known mock defect and SHALL NOT be reproduced.

#### Scenario: Project rows do not inflate the meal-plan badge

- **WHEN** the plan holds N schedulable meal rows (`meal` in breakfast/lunch/dinner) plus
  one or more project rows (`meal: 'project'`)
- **THEN** the meal-plan badge reads N

#### Scenario: The grocery badge is the derived to-buy count

- **WHEN** the grocery page's derived to-buy view holds M lines
- **THEN** the grocery badge reads M, and rows advanced to `in_cart` or `ordered` are not
  counted
