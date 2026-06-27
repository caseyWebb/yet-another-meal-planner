// Spike eval set (task 0.2): real, well-known recipes with hand-authored GOLD facets,
// curated to stress the failure modes that matter for unattended classification:
//   - controlled-vocab MAPPING edges (shrimp->shellfish, multi-protein->mixed)
//   - protein:null / cuisine:null (no-focus / agnostic dishes)
//   - off-vocab PRESSURE (shakshuka, smoothie — a tradition/none not on the list)
//   - the SILENT-failure fields: season (a wrong tag buries a recipe) and
//     requires_equipment (a wrong tag hides a makeable recipe)
//   - the perishable "would the leftover rot" test
//   - the sparse tail (does the model invent facets?) and an overloaded dish
//
// Gold is one defensible labeling; fuzzy fields (perishable_ingredients, dietary,
// ingredients_key) are scored by overlap/F1, not exact match. The exact-match fields are
// the gateable + silent ones (protein, cuisine, course, season, requires_equipment).

export const EVAL = [
  {
    id: "kimchi-fried-rice",
    title: "Kimchi Fried Rice",
    body: "Ingredients: day-old cooked rice, chopped kimchi, eggs, scallions, sesame oil, gochujang.\nInstructions: Fry kimchi until caramelized, add cold rice and gochujang, stir-fry; top with a fried egg and scallions.",
    gold: {
      protein: "vegetarian",
      cuisine: "korean",
      course: ["main"],
      season: [],
      dietary: ["vegetarian"],
      requires_equipment: [],
      perishable_ingredients: ["kimchi", "scallion"],
      ingredients_key: ["kimchi", "rice", "egg", "scallion"],
      isMain: true,
    },
  },
  {
    id: "shrimp-scampi",
    title: "Shrimp Scampi",
    body: "Ingredients: large shrimp, linguine, garlic, butter, white wine, lemon, parsley, red pepper flakes.\nInstructions: Sauté shrimp in garlic butter, deglaze with wine and lemon, toss with linguine and parsley.",
    gold: {
      protein: "shellfish", // the shrimp -> shellfish map
      cuisine: "italian",
      course: ["main"],
      season: [],
      dietary: [],
      requires_equipment: [],
      perishable_ingredients: ["shrimp", "parsley"],
      ingredients_key: ["shrimp", "linguine", "garlic", "butter", "lemon"],
      isMain: true,
    },
  },
  {
    id: "pad-thai",
    title: "Pad Thai",
    body: "Ingredients: rice noodles, shrimp, firm tofu, egg, tamarind paste, fish sauce, palm sugar, bean sprouts, peanuts, lime.\nInstructions: Soften noodles; stir-fry shrimp, tofu, and egg; toss with tamarind sauce, sprouts, peanuts, lime.",
    gold: {
      protein: "mixed", // shrimp + tofu + egg, co-equal
      cuisine: "thai",
      course: ["main"],
      season: [],
      dietary: [],
      requires_equipment: [],
      perishable_ingredients: ["shrimp", "bean sprouts", "lime"],
      ingredients_key: ["rice noodles", "shrimp", "tofu", "egg", "tamarind", "peanuts"],
      isMain: true,
    },
  },
  {
    id: "gazpacho",
    title: "Classic Gazpacho",
    body: "Ingredients: ripe tomatoes, cucumber, green pepper, garlic, stale bread, sherry vinegar, olive oil; served cold.\nInstructions: Blend everything until smooth, chill thoroughly, serve cold.",
    gold: {
      protein: null, // cold vegetable soup, no protein focus
      cuisine: "spanish",
      course: ["main", "side"], // commonly either; accept main or side
      season: ["summer"], // the season silent-failure test
      dietary: ["vegan", "vegetarian"],
      requires_equipment: ["blender"], // must be smooth -> blender
      perishable_ingredients: ["tomato", "cucumber", "green pepper"],
      ingredients_key: ["tomato", "cucumber", "green pepper", "garlic", "sherry vinegar"],
      isMain: false, // ambiguous; side_search_terms presence not scored strictly here
      courseLoose: true,
    },
  },
  {
    id: "beef-bourguignon",
    title: "Beef Bourguignon",
    body: "Ingredients: beef chuck, bacon, red wine, pearl onions, cremini mushrooms, carrots, thyme, beef stock.\nInstructions: Brown beef and bacon, braise low and slow in red wine with onions, mushrooms, carrots, and thyme.",
    gold: {
      protein: "beef",
      cuisine: "french",
      course: ["main"],
      season: ["fall", "winter"], // hearty braise -> cold seasons
      dietary: ["dairy-free"],
      requires_equipment: [],
      perishable_ingredients: ["mushrooms", "carrots", "thyme"],
      ingredients_key: ["beef chuck", "red wine", "bacon", "pearl onions", "mushrooms"],
      isMain: true,
    },
  },
  {
    id: "caprese-salad",
    title: "Caprese Salad",
    body: "Ingredients: ripe tomatoes, fresh mozzarella, fresh basil, olive oil, balsamic, flaky salt.\nInstructions: Layer sliced tomato and mozzarella, top with basil, drizzle oil and balsamic.",
    gold: {
      protein: null, // a salad/side, no protein focus
      cuisine: "italian",
      course: ["side"],
      season: ["summer"], // peak tomato + basil
      dietary: ["vegetarian", "gluten-free"],
      requires_equipment: [],
      perishable_ingredients: ["tomato", "mozzarella", "basil"],
      ingredients_key: ["tomato", "mozzarella", "basil", "balsamic"],
      isMain: false,
    },
  },
  {
    id: "chicken-tikka-masala",
    title: "Chicken Tikka Masala",
    body: "Ingredients: chicken thighs, yogurt, garam masala, ginger, garlic, crushed tomatoes, heavy cream, cilantro.\nInstructions: Marinate and char chicken, simmer in a spiced tomato-cream sauce, finish with cilantro.",
    gold: {
      protein: "chicken",
      cuisine: "indian",
      course: ["main"],
      season: [],
      dietary: ["gluten-free"],
      requires_equipment: [],
      perishable_ingredients: ["chicken", "yogurt", "heavy cream", "cilantro"],
      ingredients_key: ["chicken", "yogurt", "garam masala", "tomatoes", "cream"],
      isMain: true,
    },
  },
  {
    id: "red-lentil-dal",
    title: "Red Lentil Dal",
    body: "Ingredients: red lentils, onion, garlic, ginger, cumin, turmeric, coconut milk, spinach, cilantro.\nInstructions: Simmer lentils with aromatics and spices, stir in coconut milk and spinach, finish with cilantro.",
    gold: {
      protein: "vegan", // legume protein-forward -> vegan bucket, NOT "lentil"
      cuisine: "indian",
      course: ["main"],
      season: [],
      dietary: ["vegan", "vegetarian", "gluten-free"],
      requires_equipment: [],
      perishable_ingredients: ["spinach", "cilantro"],
      ingredients_key: ["red lentils", "coconut milk", "spinach", "cumin", "turmeric"],
      isMain: true,
    },
  },
  {
    id: "green-smoothie",
    title: "Green Smoothie",
    body: "Ingredients: spinach, banana, frozen mango, almond milk, chia seeds.\nInstructions: Blend everything until completely smooth.",
    gold: {
      protein: null,
      cuisine: null, // cuisine-agnostic
      course: ["breakfast"],
      season: [],
      dietary: ["vegan", "vegetarian", "gluten-free"],
      requires_equipment: ["blender"], // essential
      perishable_ingredients: ["spinach", "banana"],
      ingredients_key: ["spinach", "banana", "mango", "almond milk"],
      isMain: false,
    },
  },
  {
    id: "buttered-toast",
    title: "Buttered Toast",
    body: "Ingredients: bread, butter.\nInstructions: Toast the bread, spread with butter.",
    gold: {
      protein: null,
      cuisine: null,
      course: ["breakfast", "side"], // either defensible
      season: [],
      dietary: ["vegetarian"],
      requires_equipment: [],
      perishable_ingredients: [], // butter/bread aren't "rot before use"; sparse-tail test
      ingredients_key: ["bread", "butter"],
      isMain: false,
      courseLoose: true,
    },
  },
  {
    id: "vanilla-ice-cream",
    title: "Vanilla Custard Ice Cream",
    body: "Ingredients: heavy cream, whole milk, egg yolks, sugar, vanilla bean.\nInstructions: Make a custard with yolks, cream, milk, and sugar; chill, then churn in an ice cream maker until frozen.",
    gold: {
      protein: null, // dessert, no protein focus
      cuisine: null,
      course: ["dessert"],
      season: ["summer"],
      dietary: ["vegetarian", "gluten-free"],
      requires_equipment: ["ice-cream-maker"], // churned -> required
      perishable_ingredients: ["heavy cream", "milk"],
      ingredients_key: ["heavy cream", "milk", "egg yolks", "vanilla"],
      isMain: false,
      seasonLoose: true, // [] also defensible for ice cream
    },
  },
  {
    id: "shakshuka",
    title: "Shakshuka",
    body: "Ingredients: eggs, crushed tomatoes, red bell pepper, onion, garlic, cumin, paprika, feta, cilantro.\nInstructions: Simmer a spiced tomato-pepper sauce, crack in eggs, bake until set, top with feta and cilantro.",
    gold: {
      protein: "egg",
      cuisine: "mediterranean", // off-vocab pressure (Levantine/N.African); closest = mediterranean (accept moroccan)
      course: ["main", "breakfast"],
      season: [],
      dietary: ["vegetarian", "gluten-free"],
      requires_equipment: [],
      perishable_ingredients: ["red bell pepper", "feta", "cilantro"],
      ingredients_key: ["eggs", "tomatoes", "bell pepper", "feta"],
      isMain: true,
      cuisineAccept: ["mediterranean", "moroccan", "greek"],
      courseLoose: true,
    },
  },
  {
    id: "carnitas-tacos",
    title: "Pork Carnitas Tacos",
    body: "Ingredients: pork shoulder, orange, lime, garlic, cumin, bay, corn tortillas, onion, cilantro.\nInstructions: Braise pork shoulder with citrus and spices until tender, shred and crisp, serve in tortillas with onion and cilantro.",
    gold: {
      protein: "pork",
      cuisine: "mexican",
      course: ["main"],
      season: [],
      dietary: ["gluten-free", "dairy-free"],
      requires_equipment: [], // braise has a stovetop/oven version -> no required slug
      perishable_ingredients: ["onion", "cilantro", "lime"],
      ingredients_key: ["pork shoulder", "orange", "lime", "corn tortillas", "cumin"],
      isMain: true,
    },
  },
  {
    id: "thai-green-curry",
    title: "Thai Green Curry with Chicken",
    body: "Ingredients: chicken thighs, green curry paste, coconut milk, Thai eggplant, bamboo shoots, fish sauce, Thai basil, lime.\nInstructions: Fry curry paste, add coconut milk and chicken, simmer with vegetables, finish with basil and lime.",
    gold: {
      protein: "chicken",
      cuisine: "thai",
      course: ["main"],
      season: [],
      dietary: ["gluten-free", "dairy-free"],
      requires_equipment: [],
      perishable_ingredients: ["chicken", "Thai eggplant", "Thai basil", "lime"],
      ingredients_key: ["chicken", "green curry paste", "coconut milk", "Thai basil"],
      isMain: true,
    },
  },
];
