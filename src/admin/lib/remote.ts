// The admin panel's data-modeling discipline in TypeScript (operator-admin). Replaces
// Elm's krisajenkins/remotedata + custom types: a four-state remote-data union and an
// exhaustiveness helper, so "loading AND error AND value" is unrepresentable and adding a
// UI state flags every site that must handle it. See admin/CLAUDE.md (rewritten for TS).

/** A structured error as the admin API returns it (mirrors `src/errors.ts` ToolError.toShape()). */
export interface ApiError {
  error: string;
  message: string;
  [k: string]: unknown;
}

/** The four states of a remote read — the only legal combinations, one source of truth. */
export type Loadable<T, E = ApiError> =
  | { readonly status: "notAsked" }
  | { readonly status: "loading" }
  | { readonly status: "failure"; readonly error: E }
  | { readonly status: "success"; readonly value: T };

export const notAsked: Loadable<never> = { status: "notAsked" };
export const loading: Loadable<never> = { status: "loading" };
export const failure = <E>(error: E): Loadable<never, E> => ({ status: "failure", error });
export const success = <T>(value: T): Loadable<T, never> => ({ status: "success", value });

/**
 * Compile-time exhaustiveness. The `default` branch of a discriminated-union `switch`
 * passes its now-`never`-typed value here; adding a variant without handling it makes the
 * argument no longer `never`, so the build fails at every unhandled site.
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
}
