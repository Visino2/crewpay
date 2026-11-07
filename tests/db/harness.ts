import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { expect } from "vitest";

const migrationsDir = join(import.meta.dirname, "..", "..", "supabase", "migrations");
const shimPath = join(import.meta.dirname, "supabase-shim.sql");

export type TestUser = { id: string; email: string };
export type Actor = TestUser | "anon" | "service_role";

/**
 * In-process PostgreSQL (PGlite) with the Supabase test shim and every
 * migration in supabase/migrations applied in order. Each `as()` call runs
 * in its own transaction with the given role and JWT claims, the way
 * PostgREST executes a request.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = await PGlite.create();
  await pg.exec(readFileSync(shimPath, "utf8"));
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    await pg.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  return new TestDatabase(pg);
}

let emailCounter = 0;

export class TestDatabase {
  constructor(readonly pg: PGlite) {}

  async createUser(
    label: string,
    options: { confirmed?: boolean; fullName?: string } = {},
  ): Promise<TestUser> {
    emailCounter += 1;
    const email = `${label}-${emailCounter}@example.test`;
    const { rows } = await this.pg.query<{ id: string }>(
      `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
       values ($1, case when $2::boolean then now() end, $3::jsonb)
       returning id`,
      [
        email,
        options.confirmed ?? true,
        JSON.stringify(options.fullName ? { full_name: options.fullName } : {}),
      ],
    );
    return { id: rows[0]!.id, email };
  }

  async as<T>(actor: Actor, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (tx) => {
      const role = typeof actor === "string" ? actor : "authenticated";
      const claims =
        typeof actor === "string"
          ? { role }
          : { sub: actor.id, email: actor.email, role };
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
      await tx.exec(`set local role ${role}`);
      return fn(tx);
    });
  }

  async rows<R>(actor: Actor, sql: string, params: unknown[] = []): Promise<R[]> {
    return this.as(actor, async (tx) => (await tx.query<R>(sql, params)).rows);
  }

  /** Runs a statement that returns one column named `value`. */
  async value<V = string>(actor: Actor, sql: string, params: unknown[] = []): Promise<V> {
    const rows = await this.rows<{ value: V }>(actor, sql, params);
    return rows[0]!.value;
  }

  /** Runs as the migration owner (postgres), bypassing RLS. Test setup only. */
  async owner<R>(sql: string, params: unknown[] = []): Promise<R[]> {
    return (await this.pg.query<R>(sql, params)).rows;
  }
}

/**
 * Asserts the statement fails and that the error code or its detail matches,
 * e.g. message `invalid_state` with detail `stale_payout_method`.
 */
export async function expectDbError(
  promise: Promise<unknown>,
  expected: string | RegExp,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the database to raise an error").toBeInstanceOf(Error);
  const { message, detail } = caught as Error & { detail?: string };
  const text = `${message} ${detail ?? ""}`;
  if (typeof expected === "string") {
    expect(text).toContain(expected);
  } else {
    expect(text).toMatch(expected);
  }
}
