---
name: add-ready-to-eat-feedback
description: "Rate or disposition a ready-to-eat / heat-and-eat item — the convenience-meal analog of recipe feedback. Use for \"rate the frozen lasagna\", \"stop suggesting those taquitos\", or dispositioning a draft RTE discovery (activate or reject)."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-corpus` skills before continuing.

# Ready-to-eat feedback

Rate or change the status of a ready-to-eat item: call `update_ready_to_eat(slug, updates)` with the appropriate fields (drafts go to active with a rating, or rejected).
