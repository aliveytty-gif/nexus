import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const EVE = "33333333-3333-4333-8333-333333333333";
const MISSING = "99999999-9999-4999-8999-999999999999";

describe("Repost PostgreSQL permissions", { concurrency: false }, () => {
  let db: PGlite;
  let legacy: string;
  async function asUser<T>(id: string | null, operation: () => Promise<T>, role = "authenticated") {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    await db.exec(`set role ${role}`);
    try { return await operation(); } finally { await db.exec("reset role"); }
  }
  async function post(content = "Original post") {
    return (await db.query<{ id: string }>(
      "insert into public.posts (author_id, content) values (auth.uid(), $1) returning id", [content])).rows[0].id;
  }
  async function repost(id: string, comment = "") {
    return (await db.query<{ id: string }>("select public.create_repost($1, $2) as id", [id, comment])).rows[0].id;
  }
  const summaries = (ids: string[]) => db.query<{ post_id: string; repost_count: number; my_repost_id: string | null }>(
    "select * from public.get_repost_summaries($1)", [ids]);

  before(async () => {
    db = new PGlite();
    // Only Auth/Storage interfaces are emulated; production migrations, grants and RLS execute in PostgreSQL.
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
        id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
        name text, metadata jsonb, unique (bucket_id, name)
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated;
      grant all on storage.objects to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on functions to anon, authenticated;
    `);
    for (const migration of ["202609150001_core.sql", "202609230001_closed_alpha.sql", "202609240001_social_mvp.sql",
      "202610020001_media_friends_music.sql", "202610070001_media_attachments.sql", "202610110001_group_chats.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    }
    await db.query("insert into auth.users (id) values ($1), ($2), ($3)", [ALICE, BOB, EVE]);
    legacy = await asUser(ALICE, () => post("Existing text"));
    await db.exec(await readFile(new URL("../supabase/migrations/202610130001_reposts.sql", import.meta.url), "utf8"));
  });
  after(async () => { await db?.close(); });

  it("preserves legacy posts and creates empty or commented reposts without copying source media", async () => {
    assert.deepEqual((await db.query("select content, is_repost, original_post_id from public.posts where id = $1", [legacy])).rows,
      [{ content: "Existing text", is_repost: false, original_post_id: null }]);
    const id = await asUser(BOB, () => repost(legacy));
    assert.deepEqual((await db.query("select author_id, content, is_repost, original_post_id, image_url, attachments, community_id from public.posts where id = $1", [id])).rows,
      [{ author_id: BOB, content: "", is_repost: true, original_post_id: legacy, image_url: null, attachments: [], community_id: null }]);
    const commented = await asUser(EVE, () => repost(legacy, "  My comment  "));
    assert.equal((await db.query<{ content: string }>("select content from public.posts where id = $1", [commented])).rows[0].content, "My comment");
    await asUser(ALICE, async () => {
      await db.query("update public.posts set content = 'Edited source' where id = $1", [legacy]);
      await assert.rejects(() => post(""), { code: "23514" });
    });
    await asUser(BOB, () => db.query("update public.posts set content = 'Updated comment' where id = $1", [id]));
    assert.equal((await db.query<{ content: string }>("select content from public.posts where id = $1", [id])).rows[0].content, "Updated comment");
  });

  it("normalizes repost targets, keeps the first comment on retries and counts in one batch", async () => {
    const source = await asUser(ALICE, () => post());
    const first = await asUser(BOB, () => repost(source, "Keep this"));
    const second = await asUser(EVE, () => repost(first, "Normalized"));
    await asUser(BOB, async () => {
      assert.equal(await repost(source, "Do not overwrite"), first);
      assert.equal(await repost(second), first);
      const rows = (await summaries([source, first, source, MISSING])).rows;
      assert.equal(rows.length, 2);
      for (const row of rows) {
        assert.equal(Number(row.repost_count), 2);
        assert.equal(row.my_repost_id, first);
      }
      assert.deepEqual((await summaries([])).rows, []);
    });
    assert.equal((await db.query<{ original_post_id: string }>("select original_post_id from public.posts where id = $1", [second])).rows[0].original_post_id, source);
    assert.equal((await db.query<{ content: string }>("select content from public.posts where id = $1", [first])).rows[0].content, "Keep this");
    await asUser(ALICE, async () => {
      assert.equal((await summaries([source])).rows[0].my_repost_id, null);
      await assert.rejects(() => repost(source, "x".repeat(5001)), { code: "22023" });
      await assert.rejects(() => repost(MISSING), { code: "P0002" });
    });
  });

  it("enforces authentication, own authorship and immutable references for direct writes", async () => {
    await asUser(null, () => assert.rejects(() => repost(legacy), { code: "28000" }));
    await asUser(null, async () => {
      await assert.rejects(() => repost(legacy), { code: "42501" });
      await assert.rejects(() => summaries([legacy]), { code: "42501" });
    }, "anon");
    const source = await asUser(ALICE, () => post());
    const reference = await asUser(BOB, () => repost(source));
    await asUser(EVE, async () => {
      await assert.rejects(() => db.query(
        "insert into public.posts (author_id, content, is_repost, original_post_id) values ($1, '', true, $2)", [ALICE, source]), { code: "42501" });
      for (const target of [null, MISSING]) await assert.rejects(() => db.query(
        "insert into public.posts (author_id, content, is_repost, original_post_id) values (auth.uid(), '', true, $1)", [target]), { code: "P0002" });
      await assert.rejects(() => db.query(
        "insert into public.posts (author_id, content, is_repost, original_post_id) values (auth.uid(), '', true, $1)", [reference]), { code: "23514" });
      await assert.rejects(() => db.query(
        "insert into public.posts (author_id, content, original_post_id) values (auth.uid(), 'Bad', $1)", [source]), { code: "23514" });
      assert.equal((await db.query("delete from public.posts where id = $1 returning id", [reference])).rows.length, 0);
    });
    await asUser(BOB, async () => {
      await assert.rejects(() => db.query("update public.posts set original_post_id = null where id = $1", [reference]), { code: "42501" });
      await assert.rejects(() => db.query("update public.posts set is_repost = false where id = $1", [reference]), { code: "42501" });
      await assert.rejects(() => db.query("update public.posts set image_url = 'https://example.com/photo.jpg' where id = $1", [reference]), { code: "23514" });
      await assert.rejects(() => db.query("insert into public.posts (author_id, content, is_repost, original_post_id) values (auth.uid(), '', true, $1)", [source]), { code: "23505" });
    });
  });

  it("honors original visibility and private media RLS even when a repost remains visible", async () => {
    const path = `${ALICE}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-photo.jpg`;
    await asUser(ALICE, () => db.query("insert into storage.objects (bucket_id, name, metadata) values ('post-files', $1, $2)", [path, { mimetype: "image/jpeg", size: 12 }]));
    const attachment = { path, name: "photo.jpg", type: "image/jpeg", size: 12 };
    const source = (await asUser(ALICE, () => db.query<{ id: string }>(
      "insert into public.posts (author_id, content, attachments) values (auth.uid(), '', $1) returning id", [JSON.stringify([attachment])]))).rows[0].id;
    const reference = await asUser(BOB, () => repost(source));
    await asUser(BOB, () => assert.rejects(() => db.query(
      "insert into public.posts (author_id, content, is_repost, original_post_id, attachments) values (auth.uid(), '', true, $1, $2)",
      [source, JSON.stringify([attachment])]), { code: "42501" }));
    await asUser(EVE, async () => {
      assert.equal((await db.query("select name from storage.objects where name = $1", [path])).rows.length, 1);
      assert.deepEqual((await db.query<{ attachments: (typeof attachment)[] }>("select attachments from public.posts where id = $1", [source])).rows[0].attachments, [attachment]);
    });
    // Current posts are shared with authenticated users; this extra restrictive policy proves the RPC respects future visibility rules.
    await db.exec(`create policy test_hide_original on public.posts as restrictive for select to authenticated using (id <> '${source}'::uuid)`);
    try {
      await asUser(EVE, async () => {
        assert.equal((await db.query("select id from public.posts where id = $1", [reference])).rows.length, 1);
        await assert.rejects(() => repost(source), { code: "P0002" });
        await assert.rejects(() => repost(reference), { code: "P0002" });
        await assert.rejects(() => db.query("insert into public.posts (author_id, content, is_repost, original_post_id) values (auth.uid(), '', true, $1)", [source]), { code: "P0002" });
        const rows = (await summaries([source, reference])).rows;
        assert.equal(rows.length, 1);
        assert.equal(Number(rows[0].repost_count), 0);
        assert.equal(rows[0].my_repost_id, null);
        assert.equal((await db.query("select name from storage.objects where name = $1", [path])).rows.length, 0);
      });
    } finally { await db.exec("drop policy test_hide_original on public.posts"); }
    assert.deepEqual((await db.query<{ attachments: (typeof attachment)[] }>("select attachments from public.posts where id = $1", [reference])).rows[0].attachments, []);
  });

  it("keeps an editable tombstone after source deletion and permits deleting only the owned repost", async () => {
    const source = await asUser(ALICE, () => post());
    const reference = await asUser(BOB, () => repost(source));
    await asUser(ALICE, () => db.query("delete from public.posts where id = $1", [source]));
    await asUser(BOB, async () => {
      assert.deepEqual((await db.query("select is_repost, original_post_id, content from public.posts where id = $1", [reference])).rows,
        [{ is_repost: true, original_post_id: null, content: "" }]);
      assert.equal(Number((await summaries([reference])).rows[0].repost_count), 0);
      await db.query("update public.posts set content = 'Source removed' where id = $1", [reference]);
      await assert.rejects(() => repost(reference), { code: "P0002" });
      assert.equal((await db.query("delete from public.posts where id = $1 returning id", [reference])).rows.length, 1);
    });
    const remaining = await asUser(ALICE, () => post());
    const removable = await asUser(BOB, () => repost(remaining));
    await asUser(BOB, () => db.query("delete from public.posts where id = $1", [removable]));
    assert.equal((await db.query("select id from public.posts where id = $1", [remaining])).rows.length, 1);
    assert.equal(Number((await asUser(ALICE, () => summaries([remaining]))).rows[0].repost_count), 0);
  });
});
