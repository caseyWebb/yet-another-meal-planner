// Minimal ambient declarations for the Node built-ins test/sqlite-d1.ts uses. The worker's tsc
// pass is workerd-typed (`types: ["@cloudflare/workers-types"]`, no `@types/node`), so it cannot
// see `node:sqlite`/`node:fs`/`node:path`/`node:url` or `import.meta.url`. Rather than pull full
// node types into the workerd-safe pass (or exclude the queue tests from typechecking, as the
// `.live.test.ts` files are), these cover EXACTLY the surface the real-SQLite test adapter
// touches — types-only; at runtime vitest binds the real Node modules.

declare module "node:sqlite" {
  export class StatementSync {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}

declare module "node:fs" {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: string): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}

interface ImportMeta {
  url: string;
}
