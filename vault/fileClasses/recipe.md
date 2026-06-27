---
fields:
  - name: title
    type: Input
    options: {}
    path: ""
    id: 6a95ah
  - name: course
    type: Multi
    options:
      sourceType: ValuesList
      valuesListNotePath: ""
      valuesFromDVQuery: ""
      valuesList:
        "1": main
        "2": side
        "3": breakfast
        "4": lunch
        "5": dessert
        "6": snack
        "7": appetizer
        "8": soup
        "9": salad
        "10": sauce
        "11": drink
    path: ""
    id: m9bm1k
  - name: protein
    type: Select
    options:
      sourceType: ValuesList
      valuesListNotePath: ""
      valuesFromDVQuery: ""
      valuesList:
        "1": chicken
        "2": beef
        "3": pork
        "4": lamb
        "5": turkey
        "6": fish
        "7": shellfish
        "8": egg
        "9": tofu
        "10": vegetarian
        "11": vegan
        "12": mixed
    path: ""
    id: ijpvy8
  - name: cuisine
    type: Select
    options:
      sourceType: ValuesList
      valuesListNotePath: ""
      valuesFromDVQuery: ""
      valuesList:
        "1": american
        "2": brazilian
        "3": cajun
        "4": caribbean
        "5": chinese
        "6": cuban
        "7": filipino
        "8": french
        "9": german
        "10": greek
        "11": indian
        "12": italian
        "13": japanese
        "14": korean
        "15": mediterranean
        "16": mexican
        "17": moroccan
        "18": peruvian
        "19": southwestern
        "20": spanish
        "21": thai
        "22": vietnamese
    path: ""
    id: wouisx
  - name: time_total
    type: Number
    options: {}
    path: ""
    id: au87kh
  - name: source
    type: Input
    options: {}
    path: ""
    id: 7ps15k
  - name: ingredients_key
    type: Multi
    options: {}
    path: ""
    id: xttx13
  - name: dietary
    type: Multi
    options: {}
    path: ""
    id: 4dyfxv
  - name: season
    type: Multi
    options:
      sourceType: ValuesList
      valuesListNotePath: ""
      valuesFromDVQuery: ""
      valuesList:
        "1": spring
        "2": summer
        "3": fall
        "4": winter
    path: ""
    id: kpjkuw
  - name: requires_equipment
    type: Multi
    options:
      sourceType: ValuesList
      valuesListNotePath: ""
      valuesFromDVQuery: ""
      valuesList:
        "1": pressure-cooker
        "2": sous-vide-circulator
        "3": blender
        "4": ice-cream-maker
    path: ""
    id: q0zk8m
  - name: tags
    type: Multi
    options: {}
    path: ""
    id: vq54f4
  - name: pairs_with
    type: Multi
    options: {}
    path: ""
    id: jptfb7
  - name: perishable_ingredients
    type: Multi
    options: {}
    path: ""
    id: hxyt8z
  - name: side_search_terms
    type: Multi
    options: {}
    path: ""
    id: gjxdqn
limit: 100
mapWithTag: false
tagNames: []
filesPaths: []
bookmarksGroups: []
excludes: []
extends: ""
savedViews: []
favoriteView: ""
fieldsOrder: []
version: "2.1"
---

# recipe

Metadata Menu fileClass for authoring recipes. **Generated** from `src/vocab.js`
by `scripts/build-vault.mjs` — do not hand-edit; edit the source and run
`aubr build:vault`. The `protein` / `cuisine` / `season` / `requires_equipment`
dropdowns are constrained to the same vocabulary the server reconcile validates;
`course` is the open suggestion set. `description` is intentionally absent — the
Worker derives it.
