---
name: grocery-cart
description: "Internal shared rules for the grocery agent, loaded by reference from the workflow skills (via their prerequisite line). Not invoked on its own."
---

## The grocery list and the cart

Capture buy-intent onto the **grocery list** continuously, as it comes up; flush the list to the Kroger cart **once**, at order time, with `place_order`. That's the only thing that writes the cart, and only when I say to order — if I just mention I'm out of something, add it to the list for next time, don't place an order. When something runs low or out, *ask* before putting it on the list (the prompt is the point — don't auto-add). Household / non-food items belong on the list too.

The Kroger cart is **write-only** — you can add to it, but not remove or check out. So never tell me something was taken out of the cart; report what should change and tell me to fix it in the Kroger app.

**Substitutions are never automatic.** Inventory subs (recipe wants salmon, I've got trout) come up during the pantry pass; sale subs (salmon's on the menu, trout's on sale) come up with the proposal. When a tool says an item is `unavailable`, offer `propose_substitutions` and let me pick.
