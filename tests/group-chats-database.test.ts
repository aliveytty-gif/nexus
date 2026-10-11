import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const EVE = "44444444-4444-4444-8444-444444444444";
const MISSING = "99999999-9999-4999-8999-999999999999";
const FILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-photo.jpg";

describe("Group chat PostgreSQL permissions", { concurrency: false }, () => {
  let db: PGlite;
  let direct: string;

  async function asUser<T>(id: string | null, operation: () => Promise<T>, role = "authenticated") {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    await db.exec(`set role ${role}`);
    try { return await operation(); } finally { await db.exec("reset role"); }
  }
  async function create(members = [BOB, CAROL], title = "Our group") {
    return (await db.query<{ id: string }>("select public.create_group_conversation($1, $2) as id", [title, members])).rows[0].id;
  }
  const manage = (id: string, user: string, action: string) =>
    db.query("select public.manage_group_member($1, $2, $3)", [id, user, action]);
  const leave = (id: string) => db.query("select public.leave_group_conversation($1)", [id]);
  const update = (id: string, avatar: string | null = null, title = "Renamed") =>
    db.query("select public.update_group_conversation($1, $2, $3)", [id, title, avatar]);
  const upload = (path: string, mime = "image/jpeg", size: number | string = 12) =>
    db.query("insert into storage.objects (bucket_id, name, metadata) values ('message-files', $1, $2)",
      [path, { mimetype: mime, size }]);
  async function send(id: string, sender = ALICE, attachments: object[] = []) {
    return (await db.query<{ id: string }>(
      "insert into public.messages (conversation_id, sender_id, body, attachments) values ($1, $2, 'Hello', $3) returning id",
      [id, sender, JSON.stringify(attachments)])).rows[0].id;
  }
  const mark = (id: string, message: string) => db.query("select public.mark_conversation_read($1, $2)", [id, message]);

  before(async () => {
    db = new PGlite();
    // Only Auth/Storage interfaces are emulated; migrations and permissions run in PostgreSQL.
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
    for (const migration of ["202609150001_core.sql", "202609230001_closed_alpha.sql",
      "202609240001_social_mvp.sql", "202610020001_media_friends_music.sql", "202610070001_media_attachments.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    }
    await db.query("insert into auth.users (id) values ($1), ($2), ($3), ($4)", [ALICE, BOB, CAROL, EVE]);
    direct = await asUser(ALICE, async () => (await db.query<{ id: string }>(
      "select public.get_or_create_direct_conversation($1) as id", [BOB])).rows[0].id);
    await asUser(ALICE, () => send(direct));
    await db.exec(await readFile(new URL("../supabase/migrations/202610110001_group_chats.sql", import.meta.url), "utf8"));
  });
  after(async () => { await db?.close(); });

  it("preserves direct conversations and rejects group operations on them", async () => {
    await asUser(BOB, async () => {
      assert.equal((await db.query<{ id: string }>("select public.get_or_create_direct_conversation($1) as id", [ALICE])).rows[0].id, direct);
      const row = (await db.query<{ kind: string; title: null }>("select kind, title from public.conversations where id = $1", [direct])).rows[0];
      assert.deepEqual(row, { kind: "direct", title: null });
      await send(direct, BOB);
      for (const action of [() => manage(direct, CAROL, "add"), () => leave(direct), () => update(direct)]) {
        await assert.rejects(action, { code: "42501" });
      }
      assert.equal((await db.query("select * from public.conversation_members where conversation_id = $1", [direct])).rows.length, 2);
    });
    const summary = await asUser(ALICE, () => db.query<{ other_id: string; kind: string; last_body: string }>(
      "select * from public.get_conversation_summaries() where id = $1", [direct]));
    assert.equal(summary.rows[0].other_id, BOB);
    assert.equal(summary.rows[0].kind, "direct");
    assert.equal(summary.rows[0].last_body, "Hello");
  });

  it("creates deduplicated membership atomically and rejects invalid input or direct table writes", async () => {
    await asUser(ALICE, async () => {
      const id = await create([ALICE, BOB, BOB]);
      assert.deepEqual((await db.query("select user_id, role from public.conversation_members where conversation_id = $1 order by user_id", [id])).rows,
        [{ user_id: ALICE, role: "creator" }, { user_id: BOB, role: "member" }]);
      for (const title of ["", " \n\t", "x".repeat(101)]) await assert.rejects(() => create([BOB], title), { code: "22023" });
      for (const members of [[], [ALICE]]) await assert.rejects(() => create(members), { code: "22023" });
      await assert.rejects(() => create([MISSING]), { code: "P0002" });
      await assert.rejects(() => db.query("select public.create_group_conversation('Test', array[null]::uuid[])"), { code: "22023" });
      for (const sql of [
        "insert into public.conversations (kind, title) values ('group', 'Bypass')",
        "update public.conversation_members set role = 'creator'",
        "update public.conversation_members set last_read_at = now()",
        "delete from public.conversation_members",
      ]) await assert.rejects(() => db.query(sql), { code: "42501" });
      await assert.rejects(() => db.query("insert into public.conversation_members (conversation_id, user_id) values ($1, $2)", [id, EVE]), { code: "42501" });
    });
    await asUser(null, () => assert.rejects(() => create(), { code: "28000" }));
    await asUser(null, async () => {
      await assert.rejects(() => create(), { code: "42501" });
      await assert.rejects(() => db.query("select * from public.get_conversation_summaries()"), { code: "42501" });
    }, "anon");
  });

  it("limits administration by role and prevents self promotion or creator removal", async () => {
    const id = await asUser(ALICE, () => create());
    await asUser(BOB, async () => {
      for (const action of ["add", "remove", "promote", "demote"]) await assert.rejects(() => manage(id, CAROL, action), { code: "42501" });
      await assert.rejects(() => update(id), { code: "42501" });
    });
    await asUser(ALICE, async () => {
      await manage(id, BOB, "promote");
      await manage(id, CAROL, "promote");
      await assert.rejects(() => manage(id, ALICE, "remove"), { code: "42501" });
      await assert.rejects(() => manage(id, ALICE, "demote"), { code: "42501" });
    });
    await asUser(BOB, async () => {
      await manage(id, EVE, "add");
      await manage(id, EVE, "remove");
      await assert.rejects(() => manage(id, CAROL, "remove"), { code: "42501" });
      await assert.rejects(() => manage(id, ALICE, "remove"), { code: "42501" });
      await assert.rejects(() => manage(id, EVE, "promote"), { code: "P0002" });
      await assert.rejects(() => manage(id, CAROL, "demote"), { code: "42501" });
      await assert.rejects(() => update(id), { code: "42501" });
    });
    await asUser(ALICE, () => manage(id, CAROL, "demote"));
    await asUser(BOB, () => manage(id, CAROL, "remove"));
    await asUser(CAROL, () => assert.rejects(() => manage(id, CAROL, "add"), { code: "42501" }));
  });

  it("allows participant media but denies outsiders and removed members all group data and private files", async () => {
    const id = await asUser(ALICE, () => create());
    const path = `${id}/${ALICE}/${FILE}`;
    const message = await asUser(ALICE, async () => {
      await upload(path);
      return send(id, ALICE, [{ path, name: "photo.jpg", type: "image/jpeg", size: 12 }]);
    });
    await asUser(BOB, async () => {
      assert.equal((await db.query("select id from public.messages where id = $1", [message])).rows.length, 1);
      assert.equal((await db.query("select id from storage.objects where name = $1", [path])).rows.length, 1);
      await send(id, BOB);
      await assert.rejects(() => send(id, ALICE), { code: "42501" });
    });
    await asUser(ALICE, () => manage(id, BOB, "remove"));
    for (const user of [EVE, BOB]) await asUser(user, async () => {
      for (const [table, column, value] of [["conversations", "id", id], ["conversation_members", "conversation_id", id], ["messages", "conversation_id", id]]) {
        assert.equal((await db.query(`select * from public.${table} where ${column} = $1`, [value])).rows.length, 0);
      }
      assert.equal((await db.query("select * from storage.objects where name = $1", [path])).rows.length, 0);
      assert.equal((await db.query("select * from public.get_conversation_summaries() where id = $1", [id])).rows.length, 0);
      await assert.rejects(() => send(id, user), { code: "42501" });
      await assert.rejects(() => upload(`${id}/${user}/${FILE}`), { code: "42501" });
      await assert.rejects(() => mark(id, message), { code: "42501" });
      await assert.rejects(() => update(id), { code: "42501" });
      await assert.rejects(() => leave(id), { code: "42501" });
    });
  });

  it("validates avatar ownership, actual Storage metadata, MIME and the 5 MB limit", async () => {
    const id = await asUser(ALICE, () => create());
    const path = `${id}/${ALICE}/${FILE}`;
    const otherPath = `${id}/${BOB}/${FILE}`;
    await asUser(BOB, () => upload(otherPath));
    await asUser(ALICE, async () => {
      await upload(path);
      await update(id, path);
      await assert.rejects(() => update(id, otherPath), { code: "42501" });
      await assert.rejects(() => update(id, `${id}/${ALICE}/${FILE.replace("photo", "missing")}`), { code: "23514" });
      for (const [suffix, mime, size] of [["mime", "image/png", 12], ["huge", "image/jpeg", 5242881],
        ["zero", "image/jpeg", 0], ["invalid", "image/jpeg", "bad"]] as const) {
        const invalid = path.replace("photo", suffix);
        await upload(invalid, mime, size);
        await assert.rejects(() => update(id, invalid), { code: "23514" });
      }
      await update(id, null);
      assert.equal((await db.query<{ avatar_path: null }>("select avatar_path from public.conversations where id = $1", [id])).rows[0].avatar_path, null);
    });
  });

  it("transfers creator to an admin, then oldest remaining member, and removes an empty group", async () => {
    const id = await asUser(ALICE, () => create());
    const path = `${id}/${ALICE}/${FILE}`;
    await asUser(ALICE, async () => {
      await upload(path);
      await update(id, path);
      await send(id);
      await manage(id, CAROL, "promote");
      await leave(id);
    });
    await asUser(CAROL, async () => {
      assert.equal((await db.query<{ role: string }>("select role from public.conversation_members where conversation_id = $1 and user_id = $2", [id, CAROL])).rows[0].role, "creator");
      await update(id, path, "Inherited avatar");
      await leave(id);
    });
    await asUser(BOB, async () => {
      assert.equal((await db.query<{ role: string }>("select role from public.conversation_members where conversation_id = $1 and user_id = $2", [id, BOB])).rows[0].role, "creator");
      await leave(id);
    });
    assert.equal((await db.query("select id from public.conversations where id = $1", [id])).rows.length, 0);
    assert.equal((await db.query("select id from public.messages where conversation_id = $1", [id])).rows.length, 0);
  });

  it("marks only the caller's real seen message, keeps later messages unread and never moves backwards", async () => {
    const id = await asUser(ALICE, () => create());
    const first = await asUser(ALICE, () => send(id));
    const second = await asUser(ALICE, () => send(id));
    // Fixed timestamps make races between rendering and marking read reproducible.
    await db.query("update public.conversation_members set last_read_at = '2026-01-01' where conversation_id = $1", [id]);
    await db.query("update public.messages set created_at = '2026-01-02' where id = $1", [first]);
    await db.query("update public.messages set created_at = '2026-01-03' where id = $1", [second]);
    const summary = () => db.query<{ unread: boolean; last_message_id: string; other_id: null }>(
      "select * from public.get_conversation_summaries() where id = $1", [id]);
    await asUser(BOB, async () => {
      assert.equal((await summary()).rows[0].unread, true);
      await mark(id, first);
      assert.equal((await summary()).rows[0].unread, true);
      await mark(id, second);
      await mark(id, first);
      assert.deepEqual((await summary()).rows.map(({ unread, last_message_id, other_id }) => ({ unread, last_message_id, other_id })),
        [{ unread: false, last_message_id: second, other_id: null }]);
      await assert.rejects(() => mark(direct, first), { code: "P0002" });
      await assert.rejects(() => mark(id, MISSING), { code: "P0002" });
    });
    const cursors = (await db.query<{ user_id: string; last_read_at: Date }>(
      "select user_id, last_read_at from public.conversation_members where conversation_id = $1 order by user_id", [id])).rows;
    assert.equal(new Date(cursors[0].last_read_at).toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(new Date(cursors[1].last_read_at).toISOString(), "2026-01-03T00:00:00.000Z");
  });
});
