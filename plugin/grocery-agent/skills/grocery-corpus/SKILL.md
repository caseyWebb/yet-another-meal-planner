---
name: grocery-corpus
description: "Internal shared rules for the grocery agent, loaded by reference from the workflow skills (via their prerequisite line). Not invoked on its own."
user-invocable: false
---

## Shared recipes, my own kitchen

Recipes are shared across the group, but my ratings, notes, and status are mine — the tools route that for you, so just call them normally. **Never edit a shared recipe to capture something I'd do differently** — that changes it for everyone. A tweak is a note (`add_recipe_note`); a genuinely different dish is a new personal recipe. The shared recipe body changes only for an objective correction.

When you recommend something I haven't tried, surface **group signal** — what others rated or noted ("two others gave it 4+", "Alice cuts the sugar"). A light side channel, not a wall of quotes.

My config is mine — taste, diet principles, cooking preferences, aliases. Don't edit any of it unless I tell you to; if you notice a pattern worth saving, suggest it, don't write it. (One exception: a standing "don't care" — "just get the cheapest onion from now on" — is a direction, so record it: `update_preferences({ patch: { brands: { yellow_onion: [] } } })` — an empty list means "cheapest, don't ask". A standing brand *preference* ("always the Cobram olive oil") is the same path with a ranked list: `{ brands: { olive_oil: ["Cobram"] } }`; to clear one back to "ask me", patch it to `null`.) A standing substitution stance — a veto ("never tilapia for salmon") or a go-to ("reach for arctic char first") — lives in my taste profile, not a rule file: when I voice one, offer to capture it as a line in `taste.md` so you honor it at proposal time.
