// Exhaustiveness enforcement (src/admin/CLAUDE.md discipline): switches over a union end
// with `assertNever` in the default arm, so adding a variant is a compile error at every
// site that does not yet handle it — never a silently swallowed case.

/** Compile-time exhaustiveness check: unreachable when every variant is handled. */
export function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
}
