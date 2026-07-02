/* Guidance corpus for Data › Guidance — the operator-authored cooking guidance
   that lives as markdown objects under `guidance/**` in R2 (browsed by
   guidanceListing / read by guidanceObject). A nested dir/file tree; files carry
   their markdown body. Illustrative content in the system's terse voice. */
(function () {
  window.GA = window.GA || {};

  const F = (name, body) => ({ name, type: "file", body });
  const D = (name, children) => ({ name, type: "dir", children });

  window.GA.guidance = D("guidance", [
    D("cooking_techniques", [
      F("braising.md", `# Braising

Brown the protein hard and dry first — color is flavor, and a wet surface only steams. Build the liquid to come **halfway up** the meat, never submerge it. Cover, hold a bare simmer (oven at 300°F is steadier than a burner), and it's done when a fork twists free with no resistance, not at a clock time.

- Sear in batches; a crowded pan drops below browning temp.
- Reduce the strained braising liquid separately if it reads thin.
- Made a day ahead, chilled, the fat caps and lifts off clean.`),
      F("pan-searing.md", `# Pan-searing

A dry surface and a hot pan are the whole game. Pat the protein bone-dry, salt it, and let the pan get to shimmering before anything touches it.

- Don't move it. The crust releases itself when it's ready.
- Cast iron or carbon steel over nonstick — you want fond.
- Rest meat off-heat for a third of its cook time before slicing.`),
      F("knife-skills.md", `# Knife skills

Sharp is safe. A dull knife slips; a sharp one goes where you point it.

- Claw grip on the guiding hand, knuckles forward as the fence.
- Let the weight of the blade do the work on soft items.
- Hone before each session; sharpen on a stone monthly.`),
    ]),
    D("ingredients", [
      F("salt.md", `# Salt

Season in layers — a little at each stage beats a fix at the end. **Diamond Crystal kosher** is the house default; Morton is roughly twice as salty by volume, so scale down if that's what's open.

- Salt water for pasta/blanching until it tastes like the sea.
- Finishing salt (flaky) goes on after plating, for crunch.`),
      F("alliums.md", `# Alliums

Onions, garlic, shallots, leeks, scallions — the aromatic base of most savory cooking.

- Garlic burns fast and turns acrid; add it after the onions have softened.
- Sweat (low, no color) for sweetness; brown for depth.
- Scallion whites cook like a mild onion; greens go in raw at the end.`),
    ]),
    D("equipment", [
      F("cast-iron.md", `# Cast iron

The most versatile pan in the kitchen and the one members ask about most.

- Heat it slowly and fully before adding oil — it holds heat, it doesn't spread it.
- Wash with hot water and a brush; dry on the burner; wipe a film of oil.
- Acid (tomato, wine) is fine for a quick cook, not a long simmer.`),
    ]),
    F("substitutions.md", `# Common substitutions

Quick swaps the agent can suggest when a member is missing one thing.

- **Buttermilk** → 1 cup milk + 1 tbsp lemon juice, rest 5 min.
- **Shallot** → equal parts onion + a little garlic.
- **Wine (braise)** → stock + a splash of vinegar.
- **Fresh herbs** → ⅓ the amount dried, added earlier.`),
    F("pantry-staples.md", `# Pantry staples

The short list the agent assumes a stocked kitchen has, and won't add to a grocery list unless flagged low: olive oil, neutral oil, kosher salt, black pepper, garlic, onions, canned tomatoes, a vinegar, soy sauce, a grain, a dried pasta, flour, eggs, butter.`),
  ]);
})();
