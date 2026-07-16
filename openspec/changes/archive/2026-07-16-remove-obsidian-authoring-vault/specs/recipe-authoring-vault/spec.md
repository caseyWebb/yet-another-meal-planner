## REMOVED Requirements

### Requirement: A generated, distributable Obsidian authoring vault

**Reason**: The generated Obsidian vault is being retired. It was an optional, client-side authoring surface on the R2 corpus with no runtime coupling to the Worker; its build script, template, generated output, plugin fetching, and CI drift gate are all removed.

**Migration**: Author the corpus by editing `recipes/*.md` and `guidance/**/*.md` directly in the R2 bucket with any S3-compatible client (e.g. `rclone`). The bucket remains the source of truth; the Worker reconcile validates and indexes edits regardless of the editing tool.

### Requirement: Vocab-bound fields are constrained dropdowns generated from the single source of truth

**Reason**: The constrained dropdowns were a feature of the retired vault's Metadata Menu fileClass. With the vault gone, there is no client-side editing surface to constrain, and `src/vocab.js` no longer needs a vault consumer or a `build-vault --check` drift gate.

**Migration**: `src/vocab.js` remains the single source of truth for the controlled vocabulary. The Worker reconcile's server-side validator (`src/validate.ts`) is the authoritative gate: an off-vocabulary value such as `poltry` is rejected at reconcile and surfaced via `read_reconcile_errors`, `/health`, and an ntfy push, rather than being blocked at edit time.

### Requirement: The vault schema exposes only human-authored fields

**Reason**: The authoring schema was the retired vault's recipe fileClass. The authored-vs-derived boundary it encoded (authored gates + identity vs. Worker-derived facets) is independently and authoritatively held by the `recipe-facet-derivation` capability ("Descriptive facets are derived; the hard gates and identity stay authored") and `src/recipe-contract.js`.

**Migration**: Rely on `recipe-facet-derivation` and `src/recipe-contract.js` for the authored/derived split. Derived facets (`description`, `ingredients_key`, `perishable_ingredients`, `side_search_terms`, `meal_preppable`) continue to be derived by the classify pass; humans author only the gates and identity.

### Requirement: Client-side validation complements, not replaces, the server validator

**Reason**: This requirement scoped the vault's dropdowns as a non-authoritative convenience layered on the authoritative server validator. With the vault removed there is no client-side validation layer left to scope; the server validator stands alone as it always did.

**Migration**: The Worker reconcile's server-side validation remains authoritative for all corpus content, exactly as before — it never assumed vault-authored content was valid. No behavioral change results from removing the (now non-existent) client-side aid.
