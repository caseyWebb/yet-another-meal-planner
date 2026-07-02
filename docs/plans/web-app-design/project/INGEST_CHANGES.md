# Walled-source ingest — change callout

Delta over the existing admin. Home-network **scrapers** (one machine = one API
key, configured with many sources) authenticate to paid recipe sites, extract
recipes, and POST them in batches to the Worker, which feeds them into the
existing background discovery sweep.

Reference mockup: `Admin Panel.html` + the `*.jsx` screens. Admin lives in
`src/admin/` in the real repo.

---

## New surfaces

### 1. Discovery › **Scrapers** sub-tab  (read-only, SSR)
`IngestScreen.jsx` (`ScrapersView`), rendered inside `DiscoveryScreen`.
- **Scraper liveness (hero)** — one card **per machine**: overall health badge
  (`fresh` / `stale` / `never`, /health posture language), large last-push
  relative time, reported **scraper version + contract version** with a **skew
  chip** when the machine's contract is behind the Worker's, and a **per-source
  breakdown** (each configured source with its own dot + last-push + 24h count).
- **Throughput funnel** — Received → Accepted → Deduped on arrival → handed to
  sweep, then downstream pipeline outcomes (Imported / No-match / Duplicate /
  Parked) reusing the Discovery outcome colors.
- **Recent pushes** — batch log: when · scraper · source · batch count · result
  (`accepted` / `partially-deduped` / `rejected-bad-payload` / `rejected-bad-key`).

### 2. Config › **Ingest Keys** sub-page  (island, mutates)
`ConfigScreen.jsx` → `IngestKeys`; added to `config-data.jsx` groups.
- Table: Scraper (label + key prefix) · Sources (chips) · Created · Last used
  (muted "never") · Status (`active`/`revoked`).
- **Mint key** → dialog for a label → reveals the secret **once** in a callout
  with a copy button and "you won't see this again" warning. Row persists; the
  secret does not (only the prefix is retained). Mirrors the invite-code flow.
- Per-row **Revoke** (destructive, `AlertDialog` confirm).
- Empty state when no keys.

---

## Edits to existing surfaces

- **`DiscoveryScreen.jsx`**
  - Discovery is now **Candidates | Scrapers** sub-tabs (pill sub-nav).
  - Candidates view gains a compact **ingest strip** ("N scrapers · X fresh · …
    pushed today →") that turns amber on any stale/skew and links to Scrapers.
  - Pushed candidates get a **`scraper: <source>` origin badge**.
  - In the 7-stage track, **acquire renders as "arrived via push"** for pushed
    rows (distinct pre-parsed state + inbox glyph, not a fetch tick) — in both
    the mini track and the expanded stage list.
  - Candidate card shell changed from `<button>` to `div role="button"` (was
    nesting the slug-link button; invalid DOM).
- **`discovery-data.jsx`** — added pushed candidates carrying `pushed: true` and
  `origin`; the `cand()` factory now emits those fields.
- **`StatusScreen.jsx`** — new **Ingest scrapers** section (one row per machine:
  health glyph, sources count, last push, 24h count, contract-skew warning).
- **Navbar** — no new top-level item (Ingest folded into Discovery).

---

## Implied backend contract (for implementation)

- **Endpoint** — `POST /admin/api/ingest`, bearer-authed with an ingest key.
  Body = a batch of pre-parsed recipe candidates. Response reports accepted /
  deduped-on-arrival / rejected counts. Reject on bad payload or bad key.
- **Keys** (`src/operator-config.ts`) — one active key per scraper machine;
  mint returns the secret once (store a hash + prefix only); revoke is immediate
  (next push → 401). Track `created` and `last_used`.
- **Sources** — a scraper self-reports which source each pushed item came from
  (header or per-item field); liveness + counts roll up per (scraper, source).
- **Pipeline** (`src/discovery-sweep.ts`, `discovery-db.ts`) — pushed candidates
  enter the normal sweep but **skip acquire** (content arrives pre-parsed);
  persist `pushed` + `origin` on the discovery_log row so Discovery can badge
  them and mark acquire satisfied-by-push.
- **Versioning** — scraper reports its build + the recipe-**contract** version it
  targets; compare against the Worker's current contract → surface skew.
- **Health** (`src/health.ts`) — per-scraper `fresh` (pushed within threshold) /
  `stale` (overdue) / `never`; feed the Status section + posture rollup.
