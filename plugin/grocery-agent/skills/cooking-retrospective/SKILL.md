---
name: cooking-retrospective
description: "Summarize real recent eating patterns from the cooking log. Use for \"how have I been eating this month?\", \"what protein mix have I had lately?\", \"am I cooking enough?\", \"what do I keep grabbing instead of cooking?\". Reports protein/cuisine mix, cadence, cook-vs-convenience split, ready-to-eat favorites, and underused recipes; ties to diet principles."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` skill before continuing.

# Retrospective

Call `retrospective(period)` and summarize the patterns that matter: protein/cuisine mix (real cook counts, not recency), cadence (cooks/week — `recipe` + `ad_hoc` only), the cook-vs-convenience split, ready-to-eat favorites, and underused recipes worth reviving. Tie it to `diet_principles.md` when relevant ("you're light on fish this month vs. your once-a-week target"). Surface patterns; don't nag. `period` accepts `"Nd"`, `"week"`, `"month"`, `"quarter"`, `"year"`, `"all"`.
