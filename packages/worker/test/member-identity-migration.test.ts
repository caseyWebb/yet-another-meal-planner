// Migration-chain tests for 0058_member_identity (member-identity-split): the real
// migration DDL over real SQLite. The pre-0058 cases build a database migrated through
// 0057, seed pre-split rows (tenants, webauthn_credentials), then apply 0058 — proving
// the founding-member seed and the webauthn `member` backfill against genuinely old
// data, not a fresh schema. The seed statement is re-run verbatim from the migration
// file for the idempotency case (the ALTER is the one exactly-once statement, applied
// by the migration runner, so "run twice" means the seed, not the file).

import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sqliteEnv } from "./sqlite-d1.js";
import { db } from "../src/db.js";
import { insertFoundingMember } from "../src/members-db.js";
import { revoke, TENANT_TABLES, type AdminDeps } from "../src/admin.js";
import type { KvStore } from "../src/kroger-user.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "d1");
const MEMBER_IDENTITY = "0058_member_identity.sql";

/** A real SQLite database migrated through every migration BEFORE `stopAt`. */
function migratedBefore(stopAt: string): DatabaseSync {
  const raw = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    if (f === stopAt) break;
    raw.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  }
  return raw;
}

const migrationSql = () => readFileSync(join(MIGRATIONS_DIR, MEMBER_IDENTITY), "utf8");

/** The founding-member seed statement, extracted VERBATIM from the migration file. */
function seedStatement(): string {
  const stmt = migrationSql()
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("INSERT OR IGNORE INTO members"));
  if (!stmt) throw new Error("seed statement not found in 0058");
  return stmt;
}

describe("0058_member_identity over a pre-split database", () => {
  it("seeds one founding member per registered tenant (id = tenant = handle), idempotently", () => {
    const raw = migratedBefore(MEMBER_IDENTITY);
    raw.exec("INSERT INTO tenants (id, created_at, via_code) VALUES ('casey', 1000, NULL)");
    raw.exec("INSERT INTO tenants (id, created_at, via_code) VALUES ('alice', 2000, 'code1')");

    raw.exec(migrationSql());
    const rows = () =>
      raw.prepare("SELECT id, tenant, handle, created_at FROM members ORDER BY id").all() as {
        id: string;
        tenant: string;
        handle: string;
        created_at: number;
      }[];
    expect(rows()).toEqual([
      { id: "alice", tenant: "alice", handle: "alice", created_at: 2000 },
      { id: "casey", tenant: "casey", handle: "casey", created_at: 1000 },
    ]);

    // Re-running the seed changes nothing — one row per tenant, ever.
    raw.exec(seedStatement());
    expect(rows()).toHaveLength(2);
  });

  it("backfills member = tenant on pre-existing webauthn_credentials rows", () => {
    const raw = migratedBefore(MEMBER_IDENTITY);
    raw.exec(
      "INSERT INTO webauthn_credentials (tenant, credential_id, public_key, sign_count, transports, label, created_at) " +
        "VALUES ('casey', 'cred-1', 'pk', 0, NULL, NULL, 1000)",
    );
    raw.exec(migrationSql());
    const row = raw.prepare("SELECT tenant, member FROM webauthn_credentials WHERE credential_id = 'cred-1'").get() as {
      tenant: string;
      member: string;
    };
    // Exactly the member id the credential's burned-in user handle already asserts.
    expect(row).toEqual({ tenant: "casey", member: "casey" });
  });
});

describe("members over the full migration chain", () => {
  it("rejects a handle colliding with any existing member's (deployment-unique index)", async () => {
    const { env, raw } = sqliteEnv();
    await insertFoundingMember(db(env), "casey", 1000);
    // A different id re-using the handle hits idx_members_handle — surfaced as storage_error.
    await expect(
      db(env).run("INSERT INTO members (id, tenant, handle, created_at) VALUES (?1, ?2, ?3, ?4)", "m2", "casey", "casey", 2000),
    ).rejects.toMatchObject({ code: "storage_error" });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM members").get()).toEqual({ n: 1 });
  });

  it("insertFoundingMember is idempotent (INSERT OR IGNORE)", async () => {
    const { env, rows } = sqliteEnv();
    await insertFoundingMember(db(env), "casey", 1000);
    await insertFoundingMember(db(env), "casey", 9999);
    expect(rows("members")).toEqual([{ id: "casey", tenant: "casey", handle: "casey", created_at: 1000 }]);
  });

  it("a backfilled credential still resolves — founding member, zero authenticator interaction", async () => {
    // The zero-re-keying acceptance shape: a credential row exactly as the migration leaves a
    // pre-split enrollment (member backfilled to tenant) resolves through the SAME shared
    // resolver passkey login uses, to the founding member — no re-enrollment, no ceremony change.
    const { env } = sqliteEnv(["casey"]);
    const { getCredentialById } = await import("../src/webauthn-db.js");
    const { resolveIdentity, directoryFromEnv } = await import("../src/tenant.js");
    await db(env).run(
      "INSERT INTO webauthn_credentials (tenant, member, credential_id, public_key, sign_count, transports, label, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
      "casey", "casey", "cred-old", "pk", 0, null, null, 1000,
    );
    const credential = await getCredentialById(env, "cred-old");
    expect(credential?.member).toBe("casey");
    // Zero-member tenant (the registry never seeded it): the lazy guard converges on resolution.
    const resolved = await resolveIdentity(env, credential!.tenant, credential!.member, directoryFromEnv(env));
    expect(resolved).toEqual({ id: "casey", member: "casey" });
  });

  it("household purge clears the tenant's members rows with the other tenant tables", async () => {
    const { env, rows } = sqliteEnv(["casey", "alice"]);
    await insertFoundingMember(db(env), "casey", 1000);
    await insertFoundingMember(db(env), "alice", 2000);
    expect(TENANT_TABLES).toContain("members"); // the one-place purge list gained the table

    const deps: AdminDeps = {
      tenantKv: env.TENANT_KV,
      krogerKv: env.KROGER_KV as unknown as KvStore,
      oauthKv: env.KROGER_KV as unknown as KvStore,
      db: db(env),
      randomCode: () => "x",
    };
    await revoke(deps, "casey");
    expect(rows<{ id: string }>("members").map((r) => r.id)).toEqual(["alice"]);
  });
});
