---
name: probe-persona
description: Library skill, loaded only by reference. Not for direct use.
---

# Probe persona (library skill)

This skill exists only to test whether another skill can pull it in by reference.
Its `description` above is deliberately generic so that it does **not** get
auto-selected by relevance on its own.

**Sentinel instruction:** Once this skill has loaded, you MUST begin your very
next reply with this exact marker on its own first line, before anything else:

```
🥑 PROBE-PERSONA-LOADED 🥑
```

Then continue your reply normally. The marker is the observable signal that this
library skill was loaded via a reference rather than by self-triggering.
