import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const EVE = "33333333-3333-4333-8333-333333333333";
const FILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg";

describe("Closed alpha PostgreSQL permissions", { concurrency: false }, () => {
  let db: PGlite;

  before(async () => {
    db = new PGlite();
    // Only the Supabase-owned Auth/Storage interfaces are emulated. The real
    // migrations, function permissions, constraints and RLS run in PostgreSQL.
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      create schema storage;
      create table storage.buckets (
        id text primary key, name text, public boolean,
        file_size_limit bigint, allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text references storage.buckets(id), name text,
        unique (bucket_id, name)
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated;
      grant all on storage.objects to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on functions to anon, authenticated;
    `);
    for (const migration of ["202609150001_core.sql", "202609230001_closed_alpha.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    }
    await db.query("insert into auth.users (id) values ($1), ($2), ($3)", [ALICE, BOB, EVE]);
  });

  after(async () => { await db?.close(); });

  async function asUser<T>(id: string | null, operation: () => Promise<T>, role = "authenticated") {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    await db.exec(`set role ${role}`);
    try { return await operation(); } finally { await db.exec("reset role"); }
  }

  async function open(other: string | null) {
    const result = await db.query<{ id: string }>(
      "select public.get_or_create_direct_conversation($1) as id", [other],
    );
    return result.rows[0].id;
  }

  it("creates exactly two members, reuses either direction and rejects invalid users", async () => {
    const id = await asUser(ALICE, () => open(BOB));
    assert.equal(await asUser(BOB, () => open(ALICE)), id);
    assert.equal(await asUser(ALICE, () => open(BOB)), id);
    const members = await asUser(ALICE, () => db.query(
      "select user_id from public.conversation_members where conversation_id = $1 order by user_id", [id],
    ));
    assert.deepEqual(members.rows, [{ user_id: ALICE }, { user_id: BOB }]);
    await asUser(ALICE, async () => {
      for (const user of [ALICE, null]) await assert.rejects(() => open(user), { code: "22023" });
      await assert.rejects(() => open("99999999-9999-4999-8999-999999999999"), { code: "P0002" });
    });
    await asUser(null, () => assert.rejects(() => open(BOB), { code: "28000" }));
    await asUser(null, async () => {
      await assert.rejects(() => open(BOB), { code: "42501" });
      for (const table of ["conversations", "conversation_members", "messages"]) {
        await assert.rejects(() => db.query(`select * from public.${table}`), { code: "42501" });
      }
    }, "anon");
  });

  it("allows member messages while denying outsider reads, joins and forged senders", async () => {
    const id = await asUser(ALICE, () => open(BOB));
    const insert = (sender: string, body = "Привет") => db.query(
      "insert into public.messages (conversation_id, sender_id, body) values ($1, $2, $3)",
      [id, sender, body],
    );
    await asUser(ALICE, async () => {
      await insert(ALICE);
      await assert.rejects(() => insert(BOB), { code: "42501" });
      for (const body of [" \n\t", "x".repeat(5001)]) {
        await assert.rejects(() => insert(ALICE, body), { code: "23514" });
      }
      await assert.rejects(() => db.query("update public.messages set body = 'edited'"), { code: "42501" });
      await assert.rejects(() => db.query("delete from public.conversation_members"), { code: "42501" });
    });
    assert.equal((await asUser(BOB, () => db.query("select * from public.messages"))).rows.length, 1);
    await asUser(EVE, async () => {
      for (const table of ["conversations", "conversation_members", "messages"]) {
        assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0);
      }
      await assert.rejects(() => insert(EVE), { code: "42501" });
      await assert.rejects(() => db.query(
        "insert into public.conversation_members values ($1, $2)", [id, EVE],
      ), { code: "42501" });
      await assert.rejects(() => db.query(
        "insert into public.conversations (direct_key) values ($1)", [`${ALICE}:${EVE}`],
      ), { code: "42501" });
    });
  });

  it("permits HTTPS post images and public image reads but blocks foreign Storage writes", async () => {
    const buckets = await db.query<{ id: string; public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
      "select * from storage.buckets order by id",
    );
    assert.deepEqual(buckets.rows.map((row) => row.id), ["avatars", "post-media"]);
    for (const bucket of buckets.rows) {
      assert.equal(bucket.public, true);
      assert.equal(Number(bucket.file_size_limit), 5 * 1024 * 1024);
      assert.deepEqual(bucket.allowed_mime_types, ["image/jpeg", "image/png", "image/webp"]);
    }
    await asUser(ALICE, async () => {
      await db.query("insert into public.posts (author_id, content, image_url) values ($1, 'Фото', $2)",
        [ALICE, "https://example.com/photo.jpg"]);
      for (const url of ["http://example.com/a.jpg", "https://", "https://a/has space", `https://a/${"x".repeat(2048)}`]) {
        await assert.rejects(() => db.query("update public.posts set image_url = $1", [url]), { code: "23514" });
      }
      for (const bucket of ["avatars", "post-media"]) {
        await db.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, `${ALICE}/${FILE}`]);
        for (const path of [`${BOB}/${FILE}`, `${ALICE}/other/file.jpg`, `${ALICE}/file.svg`]) {
          await assert.rejects(() => db.query("insert into storage.objects (bucket_id, name) values ($1, $2)",
            [bucket, path]), { code: "42501" });
        }
      }
      await assert.rejects(() => db.query("update storage.objects set name = $1", [`${BOB}/${FILE}`]), { code: "42501" });
    });
    await asUser(BOB, async () => {
      assert.equal((await db.query("update storage.objects set name = name returning id")).rows.length, 0);
      assert.equal((await db.query("delete from storage.objects returning id")).rows.length, 0);
    });
    await asUser(null, async () => {
      assert.equal((await db.query("select * from storage.objects")).rows.length, 2);
      await assert.rejects(() => db.query("insert into storage.objects (bucket_id, name) values ('avatars', $1)",
        [`${ALICE}/${FILE}`]), { code: "42501" });
    }, "anon");
    await asUser(ALICE, async () => {
      assert.equal((await db.query("delete from storage.objects returning id")).rows.length, 2);
    });
  });
});
