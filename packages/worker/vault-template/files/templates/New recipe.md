<%*
/*
 * New recipe — Templater template for the grocery-agent authoring vault.
 *
 * Applied automatically when you create a note in `recipes/` (folder template), or
 * insert it from the Templater command. It scaffolds the human-authored recipe
 * frontmatter — the GATES + identity (required) plus the optional Tier B override
 * dropdowns — plus the body sections the cookbook renders. The DESCRIPTIVE facets are
 * DERIVED on the cron (recipe-facet-derivation): `ingredients_key`,
 * `perishable_ingredients`, `side_search_terms`, `meal_preppable`, and `description` are
 * deliberately OMITTED (the Worker fills them; anything authored here is ignored or only a
 * legacy fallback).
 *
 * Author `dietary` + `requires_equipment` (the two hard gates). Leave the Tier B dropdowns
 * (course / protein / cuisine / season / tags) BLANK to let the classifier derive them, or
 * fill one to pin an override — constrained to src/vocab.js where applicable.
 */
-%>
---
title: "<% tp.file.title %>"
source: null
time_total: null
dietary: []
requires_equipment: []
pairs_with: []
course: []
protein: null
cuisine: null
season: []
tags: []
---

## Ingredients

- 

## Instructions

1. 
