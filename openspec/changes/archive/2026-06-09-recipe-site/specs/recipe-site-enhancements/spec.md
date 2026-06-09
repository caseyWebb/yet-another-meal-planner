## ADDED Requirements

### Requirement: Metadata search

The site SHALL provide a progressively-enhanced search box on the index that filters recipes by metadata — title, tags, `ingredients_key`, cuisine, and protein — without a separate generated search index. Search state SHALL be reflected in the URL query so a filtered view is shareable and bookmarkable. With JavaScript disabled, the absence of the search box SHALL NOT impair faceted filtering or any other functionality.

#### Scenario: Ingredient query matches via ingredients_key

- **WHEN** the user types "chorizo" into the search box
- **THEN** the index narrows to recipes whose metadata (including `ingredients_key`) contains "chorizo"

#### Scenario: Search state is shareable via URL

- **WHEN** the user has an active search query
- **THEN** the URL reflects the query and loading that URL reproduces the filtered view

#### Scenario: Search degrades gracefully

- **WHEN** JavaScript is disabled
- **THEN** the search box is absent or inert and faceted filtering still works

### Requirement: Tap-to-advance read-aloud

Recipe pages SHALL offer a read-aloud mode using the browser's Web Speech API (`speechSynthesis`) that reads the current instruction step and visibly highlights it. Advancing to the next step SHALL require an explicit user action (tap/click); the system SHALL NOT auto-advance between steps. The feature SHALL start from a user gesture and SHALL degrade to absent when speech synthesis is unavailable. It SHALL NOT be relied upon as a substitute for screen-reader accessibility.

#### Scenario: Read-aloud reads and highlights the current step

- **WHEN** the user starts read-aloud on a recipe
- **THEN** the current instruction step is spoken and visibly highlighted

#### Scenario: Advance requires explicit action

- **WHEN** the spoken step finishes
- **THEN** the system waits and does not automatically advance until the user taps to move to the next step

#### Scenario: Absent gracefully when unsupported

- **WHEN** `speechSynthesis` is unavailable in the browser
- **THEN** the read-aloud control is absent and the rest of the page works normally

### Requirement: Offline and installable PWA

The site SHALL ship a web app manifest and a service worker that precache the site assets so the site works offline after first load and can be installed to the home screen on iPhone/iPad. The service worker SHALL serve assets cache-first and navigations network-first, and SHALL invalidate stale caches when site content changes. The manifest SHALL declare a standalone display mode, a theme color, an app name, and icons. The service worker SHALL be a progressive enhancement that does not affect the JavaScript-disabled baseline.

#### Scenario: Site works offline after first visit

- **WHEN** the user has loaded the site once and then goes offline
- **THEN** previously visited and precached recipe pages and the index load without a network connection

#### Scenario: Updated content invalidates stale cache

- **WHEN** site content changes and is redeployed
- **THEN** the service worker serves the updated content rather than indefinitely stale assets

#### Scenario: Installable to home screen

- **WHEN** the user adds the site to the home screen on a supported device
- **THEN** it launches in standalone mode with the configured name and icon
