# Probe plugin — task 1 validation (throwaway)

Validates the one mechanism the whole `package-agent-as-plugin` design rests on:
**can a workflow skill reliably load a referenced, near-empty-description library
skill in claude.ai?** If yes → persona-by-reference works. If no → fall back to a
broad-description always-loading persona.

## Layout

```
probe/
  .claude-plugin/plugin.json     # manifest (name only required)
  skills/
    probe-persona/SKILL.md       # library skill, generic description, carries the 🥑 sentinel
    probe-workflow/SKILL.md      # rich description; first line references probe-persona
```

## Test protocol (run in claude.ai)

1. **Upload.** Customize → Personal plugins → Create plugin → **Upload plugin**.
   Upload `grocery-probe.zip` (built from this dir; see below).
   - ✅ **Record (task 1.2):** did Upload accept this `.claude-plugin/plugin.json` +
     `skills/` layout as-is? Did it want a `.zip` of the folder, the folder itself,
     or some other shape? Note whatever it actually expects.

2. **Positive test (task 1.3).** New chat. Send: **`run the probe test`**.
   - ✅ **PASS** if the reply's first line is `🥑 PROBE-PERSONA-LOADED 🥑` →
     the workflow's reference pulled in `probe-persona`. Mechanism works.
   - ❌ **FAIL** if the marker is absent → the reference did not load the library skill.

3. **Control test.** New chat. Send an unrelated message (e.g. `what's 2+2`).
   - Expected: marker **absent** — confirms `probe-persona` does not self-trigger on
     its own (its description is generic). If the marker shows up here, the persona is
     auto-loading by relevance, which muddies the result.

## Outcome → decision (task 1.4)

- **PASS + control clean** → proceed with persona-by-reference (design D1 as written).
- **FAIL** (or control dirty) → switch `grocery-persona` to a broad description so it
  auto-loads on any grocery/cook/meal/shopping intent (always-resident fallback);
  update design.md D1 before continuing to task 2.

## Build the zip

```bash
cd openspec/changes/package-agent-as-plugin/probe
zip -r ../grocery-probe.zip .claude-plugin skills
```

Delete the probe (`probe/` + the zip) once task 1 is decided.
