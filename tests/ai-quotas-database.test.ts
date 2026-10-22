import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const OTHER_REQUEST = "99999999-9999-4999-8999-999999999999";
type Reservation = {
  allowed: boolean;
  code?: "user_limit" | "global_limit" | "rate_limit" | "busy";
  request_id?: string;
  user_remaining: number;
  global_remaining: number;
  retry_after?: number;
};

// Real PostgreSQL constraints, grants, RLS and RPCs with only the Auth bridge stubbed.
// PGlite serializes queries; these tests do not claim simultaneous-worker coverage.
describe("AI provider-attempt quotas", { concurrency: false }, () => {
  let db: PGlite;

  before(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on functions to anon, authenticated;
    `);
    await db.exec(await readFile(new URL(
      "../supabase/migrations/202610220001_ai_quotas.sql", import.meta.url,
    ), "utf8"));
  });

  beforeEach(async () => {
    await db.exec(`
      reset role;
      truncate public.ai_user_usage, auth.users cascade;
      update public.ai_quota_settings set user_limit = 5, global_limit = 40;
      update public.ai_global_usage set usage_day = (clock_timestamp() at time zone 'UTC')::date,
        attempts = 0, recent_attempts = '{}';
    `);
    await db.query("insert into auth.users (id) values ($1), ($2)", [ALICE, BOB]);
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  });
  after(async () => { await db?.close(); });

  async function asUser<T>(actor: string | null, operation: () => Promise<T>) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor ?? ""]);
    await db.exec("set role authenticated");
    try { return await operation(); }
    finally { await db.exec("reset role"); }
  }

  async function reserve(actor = ALICE, userLimit = 5, globalLimit = 40, request: string | null = null) {
    return asUser(actor, async () => {
      const result = await db.query<{ result: Reservation }>(
        "select public.reserve_ai_request($1, $2, $3::uuid) as result",
        [userLimit, globalLimit, request],
      );
      return result.rows[0].result;
    });
  }

  async function finish(actor: string, request: string) {
    await asUser(actor, () => db.query("select public.finish_ai_request($1::uuid)", [request]));
  }

  async function clearCooldown(actor = ALICE) {
    await db.query("update public.ai_user_usage set last_attempt_at = clock_timestamp() - interval '11 seconds' where user_id = $1", [actor]);
  }

  it("counts the initial attempt and one fallback; finish never refunds quota", async () => {
    const first = await reserve();
    assert.equal(first.allowed, true);
    assert.ok(first.request_id);
    assert.equal(first.user_remaining, 4);
    assert.equal(first.global_remaining, 39);
    const fallback = await reserve(ALICE, 5, 40, first.request_id);
    assert.equal(fallback.allowed, true);
    assert.equal(fallback.request_id, first.request_id);
    assert.equal(fallback.user_remaining, 3);
    assert.equal(fallback.global_remaining, 38);
    assert.equal((await reserve(ALICE, 5, 40, first.request_id)).code, "busy");
    await finish(ALICE, first.request_id);
    const result = await db.query<{ attempts: number; request_id: string | null }>(
      "select attempts, request_id from public.ai_user_usage where user_id = $1", [ALICE],
    );
    assert.deepEqual(result.rows[0], { attempts: 2, request_id: null });
    assert.equal((await reserve(ALICE, 5, 40, first.request_id)).code, "busy");
  });

  it("rejects parallel requests and enforces cooldown even after finish", async () => {
    const first = await reserve();
    const busy = await reserve();
    assert.equal(busy.code, "busy");
    assert.ok(busy.retry_after! > 0 && busy.retry_after! <= 90);
    await finish(ALICE, first.request_id!);
    const cooling = await reserve();
    assert.equal(cooling.code, "rate_limit");
    assert.ok(cooling.retry_after! > 0 && cooling.retry_after! <= 10);
    await clearCooldown();
    assert.equal((await reserve()).allowed, true);
  });

  it("cannot steal, invent or clear somebody else's reservation", async () => {
    const first = await reserve();
    assert.equal((await reserve(BOB, 5, 40, first.request_id)).code, "busy");
    assert.equal((await reserve(ALICE, 5, 40, OTHER_REQUEST)).code, "busy");
    await finish(BOB, first.request_id!);
    await finish(ALICE, OTHER_REQUEST);
    assert.equal((await reserve()).code, "busy");
    assert.equal((await reserve(ALICE, 5, 40, first.request_id)).allowed, true);
  });

  it("expires abandoned leases and rejects their fallback", async () => {
    const first = await reserve();
    await db.query(`update public.ai_user_usage set lease_expires_at = clock_timestamp() - interval '1 second',
      last_attempt_at = clock_timestamp() - interval '91 seconds' where user_id = $1`, [ALICE]);
    assert.equal((await reserve(ALICE, 5, 40, first.request_id)).code, "busy");
    const next = await reserve();
    assert.equal(next.allowed, true);
    assert.notEqual(next.request_id, first.request_id);
    await finish(ALICE, first.request_id!);
    assert.equal((await reserve()).code, "busy");
  });

  it("caps client-supplied limits against owner settings and never exceeds the counter", async () => {
    await db.exec("update public.ai_quota_settings set user_limit = 2, global_limit = 3");
    const first = await reserve(ALICE, 1_000_000, 1_000_000);
    assert.equal(first.user_remaining, 1);
    assert.equal(first.global_remaining, 2);
    const second = await reserve(ALICE, 1_000_000, 1_000_000, first.request_id);
    assert.equal(second.allowed, true);
    await finish(ALICE, first.request_id!);
    await clearCooldown();
    for (let i = 0; i < 3; i++) assert.equal((await reserve(ALICE, 1_000_000, 1_000_000)).code, "user_limit");
    assert.equal((await reserve(BOB, 1_000_000, 1_000_000)).allowed, true);
    await db.exec("update public.ai_user_usage set request_id = null, lease_expires_at = null, last_attempt_at = null where user_id = '22222222-2222-4222-8222-222222222222'");
    assert.equal((await reserve(BOB, 1_000_000, 1_000_000)).code, "global_limit");
    const global = await db.query<{ attempts: number }>("select attempts from public.ai_global_usage");
    assert.equal(global.rows[0].attempts, 3);
  });

  it("allows environment limits to lower caps and zero to disable requests", async () => {
    assert.equal((await reserve(ALICE, 0, 40)).code, "user_limit");
    assert.equal((await reserve(ALICE, 5, 0)).code, "global_limit");
    const first = await reserve(ALICE, 1, 40);
    assert.equal(first.allowed, true);
    assert.equal((await reserve(ALICE, 1, 40, first.request_id)).code, "user_limit");
    await db.exec("update public.ai_quota_settings set user_limit = 0");
    assert.equal((await reserve(BOB, 5, 40)).code, "user_limit");
  });

  it("applies a global sliding 20-per-minute limit to fallbacks too", async () => {
    await db.exec("update public.ai_quota_settings set user_limit = 50, global_limit = 50");
    const first = await reserve(ALICE, 50, 50);
    // Nineteen earlier attempts plus the first reservation occupy all 20 slots.
    await db.exec(`update public.ai_global_usage set attempts = 20,
      recent_attempts = array_fill(clock_timestamp() - interval '1 second', array[20])`);
    const denied = await reserve(ALICE, 50, 50, first.request_id);
    assert.equal(denied.code, "rate_limit");
    assert.ok(denied.retry_after! > 0 && denied.retry_after! <= 60);
    await db.exec(`update public.ai_global_usage set recent_attempts =
      array_fill(clock_timestamp() - interval '61 seconds', array[20])`);
    const fallback = await reserve(ALICE, 50, 50, first.request_id);
    assert.equal(fallback.allowed, true);
    assert.equal(fallback.global_remaining, 29);
    const count = await db.query<{ size: number }>("select cardinality(recent_attempts) as size from public.ai_global_usage");
    assert.equal(count.rows[0].size, 1);
  });

  it("rolls daily counters at UTC midnight while retaining short-lived rate guards", async () => {
    const first = await reserve();
    await finish(ALICE, first.request_id!);
    await db.exec(`update public.ai_global_usage set usage_day = (clock_timestamp() at time zone 'UTC')::date - 1, attempts = 40;
      update public.ai_user_usage set usage_day = (clock_timestamp() at time zone 'UTC')::date - 1, attempts = 5;`);
    assert.equal((await reserve()).code, "rate_limit");
    await clearCooldown();
    const next = await reserve();
    assert.equal(next.allowed, true);
    assert.equal(next.user_remaining, 4);
    assert.equal(next.global_remaining, 39);
  });

  it("revokes direct table access, anonymous RPCs and owner-settings changes", async () => {
    for (const table of ["ai_quota_settings", "ai_global_usage", "ai_user_usage"]) {
      for (const query of [`select * from public.${table}`, `delete from public.${table}`]) {
        await assert.rejects(asUser(ALICE, () => db.exec(query)), /permission denied/);
      }
      const rls = await db.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where oid = $1::regclass", [`public.${table}`],
      );
      assert.equal(rls.rows[0].relrowsecurity, true);
    }
    await assert.rejects(asUser(ALICE, () => db.exec("update public.ai_quota_settings set global_limit = 50")), /permission denied/);
    await assert.rejects(asUser(null, () => db.exec("select public.reserve_ai_request()")), /Authentication required/);
    await assert.rejects(asUser(null, () => db.query("select public.finish_ai_request($1::uuid)", [OTHER_REQUEST])), /Authentication required/);
    await db.exec("set role anon");
    try {
      await assert.rejects(db.exec("select public.reserve_ai_request()"), /permission denied/);
      await assert.rejects(db.query("select public.finish_ai_request($1::uuid)", [OTHER_REQUEST]), /permission denied/);
    } finally { await db.exec("reset role"); }
    await assert.rejects(db.exec("update public.ai_quota_settings set global_limit = 51"), /check constraint/);
  });
});
