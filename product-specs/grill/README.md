# Grill appendix — yamp product-spec set

Date: 2026-07-10 (session 1, grilling round).

**What the grill was.** An adversarial per-finding verification pass over the product-spec set (`product-specs/`), run through 8 lenses: consistency, doctrine, datamodel, migration, privacy, widgets, sequencing, toolcontract. Each candidate finding was independently verified against the repo (code, openspec living specs, docs, D1 schema) before acceptance. Outcome: 38 confirmed findings, 32 minors, 25 rejected.

**Contents.**
- `findings.md` — the 38 confirmed findings, grouped by lens, each annotated with the DECISIONS.md entry (D10–D33) that resolved it. Descriptions and evidence are verbatim; resolution text is trimmed to a gist where the D-entry now carries it.
- `rejected-and-minors.md` — the 25 rejected findings with verifier notes (settled non-issues: do **not** re-raise these against the spec set), plus the 32 minors with resolution gists.

**How to use this appendix.**
- As evidence for DECISIONS.md D10–D33: each decision's `covers:` line traces back to findings here; this file set carries the original evidence and file:line references.
- Before filing a new finding against the spec set, check `rejected-and-minors.md` first — the rejected list exists to prevent re-litigating questions the grill already verified as covered, immaterial, or factually wrong.
- Three D-entries were amended at ratification (D26-final, D29-final, D30-final) plus D13-amendment; where a finding cites D26/D29/D30, the `-final` text in DECISIONS.md wins.
