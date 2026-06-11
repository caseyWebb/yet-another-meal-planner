---
name: probe-workflow
description: Use when the user says "run the probe test" or asks to validate the persona-reference mechanism. A stand-in for a real grocery workflow skill whose first line pulls in the shared persona.
---

# Probe workflow

**Before doing anything else, load the `probe-persona` skill and follow its
instructions.** (In the real plugin this first line is how every workflow skill
pulls in `grocery-persona`.)

Once you have loaded `probe-persona`, confirm to the user that the probe workflow
ran. Your reply should therefore begin with the persona's sentinel marker if the
reference loaded correctly.
