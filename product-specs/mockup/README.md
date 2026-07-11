# Interactive design mockup (Claude Design export, July 2026)

The source-of-truth interactive mockup behind this spec set: the full **Member App**
plus the five standalone widgets (Meal Planning, Grocery List, Order Review, Recipe
Card, RecipeRow) and the `@grocery-agent/ui` design-system bundle (`_ds/`). The curated
renders in `../screens/` were captured from these pages; come here when a spec question
needs microcopy, an interaction, or a state the screenshots don't show.

**This is a painted door (DECISIONS.md D5)** — its hardcoded data and unwired states
demonstrate the intended experience, never the mechanism. The design system's look is
owned by the companion Claude Design project; per CLAUDE.md, new/changed surfaces go
through that project (see `../design-requests.md`), not ad-hoc edits here.

## Rendering

The pages are self-contained (React/Babel vendored under `vendor/`; `support.js` is
patched to load them locally instead of unpkg). They will NOT render from `file://` —
serve the directory over HTTP:

```bash
cd product-specs/mockup && python3 -m http.server 8099
# or any static server; then open http://localhost:8099/Member%20App.dc.html
```

In a hosted Claude Code session, drive it with Playwright
(`executablePath: '/opt/pw-browsers/chromium'`) and bypass the egress proxy for
localhost (`HTTP_PROXY= HTTPS_PROXY= node …`).

Navigation is client state, not URLs: sidebar buttons switch pages; the Settings gear
opens Profile & preferences (six tabs); the Retrospective page has log/spend/waste tabs;
the profile page state object near the end of `Member App.dc.html` (`go('…')`,
`profileTab`, `retroTab`) is the routing map. The widget `.dc.html` files render
standalone with their own harness bars (mode/tab switchers, dark-mode toggle).

Not included: the working-iteration screenshots from the design bundle (superseded by
these final pages) and the design bundle's zip packaging.
