## ADDED Requirements

### Requirement: Admin visual layer is a Basecoat design system compiled by Tailwind

The admin panel's visual layer SHALL be the **Basecoat** component system (a Tailwind CSS component library using shadcn/ui-compatible CSS-variable tokens), applied through Basecoat's documented class API — a root component class plus `data-variant`/`data-size` attributes (e.g. `<button class="btn" data-variant="destructive">`) — rather than a bespoke hand-authored stylesheet. The panel SHALL use a single pinned Basecoat **style pack**, and its theme tokens (e.g. `--primary`) SHALL be overridable in a project theme layer so the operator accent is preserved without forking the pack.

The served stylesheet SHALL be **compiled by the admin build**: the `build-admin` script SHALL run Tailwind over the panel's source to produce `admin/dist/admin/styles.css`, including the Basecoat component layer and only the Tailwind utilities the panel's source uses. Consistent with the admin build model, `admin/dist/` is a **gitignored build artifact** built fresh by CI, the deploy, and local `wrangler dev` — not committed. This build SHALL NOT fetch from a network package registry (it runs from installed dependencies), preserving the panel's "any sandbox can rebuild it" guarantee.

Interactive surfaces SHALL use Basecoat's **CSS-only** components — including the native `<dialog>` element for modals and a native styled select — and SHALL keep their behavior in the panel's own island state; the panel SHALL NOT load Basecoat's component JavaScript, so read-only pages continue to ship no client JavaScript and no second runtime mutates island-owned DOM.

#### Scenario: Components use the Basecoat class API

- **WHEN** the component kit renders a primitive (button, card, input, badge, alert, table, dialog)
- **THEN** it emits Basecoat's documented markup and `data-variant`/`data-size` API, styled by the compiled Basecoat stylesheet, not a bespoke per-component class

#### Scenario: Stylesheet is compiled from source without a registry

- **WHEN** the admin bundle is built (including in a sandbox with no package-registry access)
- **THEN** the build compiles `admin/dist/admin/styles.css` from the panel source via Tailwind with no network fetch (a gitignored artifact built fresh, not a committed bundle)

#### Scenario: Operator accent is preserved through theme tokens

- **WHEN** the panel is themed
- **THEN** the Basecoat style pack's tokens are overridden in a project theme layer (e.g. `--primary` set to the operator accent), with the style pack itself unforked

#### Scenario: Interactive surfaces load no Basecoat JavaScript

- **WHEN** an island provides interactivity (e.g. a detail dialog, a member action, a config form)
- **THEN** it uses Basecoat CSS-only components (native `<dialog>`, native select) with behavior held in island state, and no Basecoat component JavaScript is loaded — so read-only pages ship no client JavaScript
