## 1. Data plumbing

- [x] 1.1 Add `meal` to `LogRow` in `packages/app/src/lib/data.ts` (the `/api/log` read already
      returns it) and to `LogAddVars` in `packages/app/src/lib/mutations.ts` (the POST forwards it).

## 2. Retrospective shell + cooking-log tab

- [x] 2.1 Add `packages/app/src/routes/_app.retrospective.tsx`: `page-head`, `prof-tabs` shell
      (Cooking log default / Spend / Waste placeholders), `?tab` search param.
- [x] 2.2 Cooking-log tab composer: meal segmented (time-of-day default), source segmented (From
      cookbook / Something else), per-source input, date picker with backdating, "Log it";
      meal+date persist on submit.
- [x] 2.3 Cooking-log tab list: day grouping (Today/Yesterday/date + "N LOGGED"), meal-ordered
      rows with meal tag, recipe link + facets or "made something else" badge, delete.
- [x] 2.4 Redirect `/log` → `/retrospective` (`_app.log.tsx`); rename the nav entry in `_app.tsx`.
- [x] 2.5 Port the mockup's retro composer/day-group/entry CSS into `packages/ui/src/cookbook.css`.
- [x] 2.6 Regenerate `routeTree.gen.ts` (build:app).

## 3. Coverage

- [x] 3.1 Turn the log page object into the retrospective page object (path `/retrospective`,
      tab + composer + day-group helpers); update the registry/fixtures.
- [x] 3.2 Update/extend specs: tab switching, meal+source composer logs correctly, day grouping
      + meal tags render, backdating, `/log` redirect.
- [x] 3.3 `openspec validate`, app typecheck, the retrospective spec + smoke.

## 4. Lockstep

- [x] 4.1 Confirm no docs (TOOLS/SCHEMAS/ARCHITECTURE), Worker route, D1 schema, `@yamp/contract`,
      or satellite-version change (backend landed in band 1; this is member UI only).
