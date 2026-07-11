## 1. Shared Orchestration

- [x] 1.1 Add a pure shared propose orchestration module under `packages/ui/src` with session/request/view types and helper exports.
- [x] 1.2 Move canonical request serialization into the shared module, preserving current `nights`, `nudges`, sorted `exclude`, and sorted `slots[]` behavior.
- [x] 1.3 Move widget request hydration and slot-to-view projection into the shared module without importing React, localStorage, TanStack Query, or ext-apps.

## 2. Host Integration

- [x] 2.1 Update the member app propose library and route to import shared helpers while keeping localStorage, `usePropose`, date packing, and commit behavior host-owned.
- [x] 2.2 Update the MCP `ProposeCard` to import shared helpers while keeping bridge calls, capability checks, race handling, read-only degradation, and sendMessage commit delegation host-owned.
- [x] 2.3 Remove duplicated session/request/view helper definitions from the host files.

## 3. Verification

- [x] 3.1 Add focused unit coverage for shared request serialization and slot-view projection.
- [x] 3.2 Run `openspec validate "propose-orchestration-unification"`.
- [x] 3.3 Run focused package validation for the touched app/widget/ui surfaces.
- [x] 3.4 Confirm no docs contract, Worker route, D1 schema, `@yamp/contract`, or satellite-version changes are required.
