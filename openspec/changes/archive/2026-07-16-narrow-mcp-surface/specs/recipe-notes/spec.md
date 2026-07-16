# recipe-notes — delta

## MODIFIED Requirements

### Requirement: An author may edit or delete their own notes

The system SHALL allow an author to edit or delete a note **they** authored, through the shared note-mutation operation surfaced by the member web app's recipe detail (there are no `update_recipe_note` / `remove_recipe_note` MCP tools — chat keeps only note **capture**, `add_recipe_note`, and the `read_recipe_notes` read). The operation addresses the note by its `created_at` (a millisecond-precision ISO timestamp, distinct per write). Passing `tier` re-tiers the note — tier changes ride this same operation and take effect on the next read (the live lens). Unlike note creation (lens-gated — see `data-write-tools`), edit and delete SHALL remain reachable for a recipe that has left the caller's lens: they address only the caller's own existing rows (no read oracle, no new annotation), and an author must always be able to re-tier — e.g. privatize — or remove their own note after a friendship sever shrinks their lens. These operations SHALL act **only** on `recipe_notes` rows whose `author` is the calling member — a member SHALL NOT edit or delete another member's note — scoped by an `author = ?` predicate on the row write. Editing or deleting a note SHALL NOT modify shared recipe content or any other member's notes. (The same mutation core backs store notes under the `in-store-fulfillment` capability; store notes keep the binary `private` flag and are not tiered.)

#### Scenario: Author edits their own note from the member app

- **WHEN** the author of a note edits it on the recipe detail page with that note's `created_at` and a new body
- **THEN** the note's `recipe_notes` row is updated (scoped to `author = caller`), leaving shared recipe content and other notes untouched

#### Scenario: Author re-tiers their own note

- **WHEN** the author re-tiers their `friends` note to `public`
- **THEN** the row's tier becomes `public` and the note is visible to the recipe's whole audience on the next read

#### Scenario: Another member's note is not addressable

- **WHEN** a member's edit/delete targets a `created_at` that matches only another member's note
- **THEN** the operation is a structured no-op / `not_found` and that note is unchanged

#### Scenario: Chat has capture and read only

- **WHEN** the member MCP tool surface is enumerated
- **THEN** it carries `add_recipe_note` and `read_recipe_notes` but no note edit or delete tool
