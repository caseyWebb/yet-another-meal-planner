---
name: cooking-retrospective
description: "Summarize real recent eating patterns from the cooking log. Use for \"how have I been eating this month?\", \"what protein mix have I had lately?\", \"am I cooking enough?\", \"what do I keep grabbing instead of cooking?\". Reports protein/cuisine mix, cadence, cook-vs-convenience split, ready-to-eat favorites, and underused favorites worth reviving; ties to diet principles."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` skill before continuing.

# Retrospective

Call `retrospective(period)` and summarize the patterns that matter: protein/cuisine mix (real cook counts, not recency), cadence (cooks/week — `recipe` + `ad_hoc` only), the cook-vs-convenience split, ready-to-eat favorites, and **underused** — loved recipes (my favorites, or ones I cook a lot) that have gone quiet and are in season now. Frame a revival off each item's `why`: a `favorite` is "you starred X but haven't made it lately" (or "…and never have" when `last_cooked` is null); a `revealed` one is "you used to make X all the time" — lean on `cook_count` there. If `underused_count` exceeds the list shown, say there are more. Tie it to my diet principles when relevant ("you're light on fish this month vs. your once-a-week target"). Surface patterns; don't nag — one or two revival nudges at most.

**Offer to fold a real pattern back into my profile.** When the history reveals something durable that my taste profile or diet principles don't already capture — a cuisine I clearly gravitate to, a protein I keep skipping, a variety target reality says I should adjust ("you've set fish weekly but average twice a month — want to make that the target, or should I push fish harder?") — *offer* to update it: `update_taste` for a taste lean, `update_diet_principles` for a target or rule. Same posture as everywhere else: **suggest, never write on your own** — propose the specific edit, and only call the tool once I say yes. One or two offers at most; don't turn a summary into an interrogation.
