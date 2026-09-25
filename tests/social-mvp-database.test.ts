import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const EVE = "33333333-3333-4333-8333-333333333333";
const FILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-notes.txt";

describe("Social MVP PostgreSQL permissions", { concurrency: false }, () => {
  let db: PGlite;
  let conversation: string;
  let otherConversation: string;
  let group: string;
  let channel: string;
  let post: string;
  const path = () => `${conversation}/${ALICE}/${FILE}`;

  async function asUser<T>(id: string | null, operation: () => Promise<T>, role = "authenticated") {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    await db.exec(`set role ${role}`);
    try { return await operation(); } finally { await db.exec("reset role"); }
  }

  async function scalar(sql: string, params: (string | null)[]) {
    return (await db.query<{ id: string }>(sql, params)).rows[0].id;
  }

  async function upload(name: string, mime = "text/plain", size = 12) {
    return db.query("insert into storage.objects (bucket_id, name, metadata) values ('message-files', $1, $2)",
      [name, { mimetype: mime, size }]);
  }

  async function attach(options: {
    name?: string; mime?: string; size?: number; filePath?: string; sender?: string; conversationId?: string; body?: string;
  } = {}) {
    return db.query(`insert into public.messages
      (conversation_id, sender_id, body, attachment_path, attachment_name, attachment_type, attachment_size)
      values ($1, $2, $3, $4, $5, $6, $7) returning id`, [
      options.conversationId ?? conversation, options.sender ?? ALICE, options.body ?? "",
      options.filePath ?? path(), options.name ?? "notes.txt", options.mime ?? "text/plain", options.size ?? 12,
    ]);
  }

  before(async () => {
    db = new PGlite();
    // Emulate only the Supabase-owned Auth/Storage interfaces. Real migrations,
    // grants, constraints, triggers and RLS execute in PostgreSQL below.
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
        bucket_id text references storage.buckets(id), name text, metadata jsonb,
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
    await asUser(ALICE, async () => {
      conversation = await scalar("select public.get_or_create_direct_conversation($1) as id", [BOB]);
      otherConversation = await scalar("select public.get_or_create_direct_conversation($1) as id", [EVE]);
      post = await scalar("insert into public.posts (author_id, content) values ($1, 'Existing post') returning id", [ALICE]);
      await db.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Existing message')",
        [conversation, ALICE]);
    });
    await db.exec(await readFile(new URL("../supabase/migrations/202609240001_social_mvp.sql", import.meta.url), "utf8"));
    await asUser(ALICE, async () => {
      group = await scalar("select public.create_community('Group', '', 'group', null) as id", []);
      channel = await scalar("select public.create_community('Channel', '', 'channel', null) as id", []);
    });
  });

  after(async () => { await db?.close(); });

  it("preserves existing text messages/posts and configures only private attachments", async () => {
    const bucket = (await db.query<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
      "select * from storage.buckets where id = 'message-files'",
    )).rows[0];
    assert.equal(bucket.public, false);
    assert.equal(Number(bucket.file_size_limit), 10 * 1024 * 1024);
    assert.deepEqual(bucket.allowed_mime_types, ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain",
      "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip", "application/x-zip-compressed"]);
    await asUser(ALICE, async () => {
      assert.equal((await db.query("select * from public.posts where community_id is null")).rows.length, 1);
      assert.equal((await db.query("select * from public.messages where attachment_path is null")).rows.length, 1);
      await db.query("update public.posts set content = 'Updated existing post' where id = $1", [post]);
      for (const body of ["", " \n\t", "x".repeat(5001)]) {
        await assert.rejects(() => db.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, $3)",
          [conversation, ALICE, body]), { code: "23514" });
      }
    });
  });

  it("allows A to upload/send, B to read, and denies C private files and forged paths", async () => {
    await asUser(ALICE, async () => {
      await upload(path());
      await attach();
      await attach({ body: "With text" });
      for (const filePath of [`${conversation}/${BOB}/${FILE}`, `${conversation}/${ALICE}/../../notes.txt`,
        `${conversation}/${ALICE}/notes.txt`, `bad/${ALICE}/${FILE}`, `${conversation}/${ALICE}/${FILE}.html`]) {
        await assert.rejects(() => upload(filePath), { code: "42501" });
      }
      assert.equal((await db.query("update storage.objects set name = name where bucket_id = 'message-files' returning id")).rows.length, 0);
      await assert.rejects(() => attach({ sender: BOB }), { code: "42501" });
      await assert.rejects(() => attach({ conversationId: otherConversation }), { code: "42501" });
    });
    await asUser(BOB, async () => {
      assert.equal((await db.query("select * from storage.objects where name = $1", [path()])).rows.length, 1);
      assert.equal((await db.query("select * from public.messages where attachment_path = $1", [path()])).rows.length, 2);
      await assert.rejects(() => attach({ sender: BOB }), { code: "42501" });
      assert.equal((await db.query("delete from storage.objects returning id")).rows.length, 0);
    });
    await asUser(EVE, async () => {
      assert.equal((await db.query("select * from storage.objects where name = $1", [path()])).rows.length, 0);
      assert.equal((await db.query("select * from public.messages where conversation_id = $1", [conversation])).rows.length, 0);
      await assert.rejects(() => upload(`${conversation}/${EVE}/${FILE}`), { code: "42501" });
      await assert.rejects(() => attach({ sender: EVE }), { code: "42501" });
    });
  });

  it("validates attachment existence, all fields, Storage MIME and exact size in the database", async () => {
    await asUser(ALICE, async () => {
      for (const options of [{ mime: "application/pdf" }, { size: 11 }, { size: 10485761 }, { name: "../notes.txt" },
        { name: "bad\\name.txt" }, { name: "bad\nname.txt" }, { name: " " }, { body: "x".repeat(5001) },
        { filePath: path().replace("notes.txt", "absent.txt") }]) {
        await assert.rejects(() => attach(options), { code: "23514" });
      }
      for (const column of ["attachment_path", "attachment_name", "attachment_type", "attachment_size"]) {
        await assert.rejects(() => db.query(`insert into public.messages (conversation_id, sender_id, body, ${column})
          values ($1, $2, 'partial', $3)`, [conversation, ALICE, column === "attachment_size" ? 12 : "partial"]), { code: "23514" });
      }
      const badMetadataPath = path().replace("notes.txt", "broken.txt");
      await upload(badMetadataPath, "text/plain", 0);
      await assert.rejects(() => attach({ filePath: badMetadataPath, size: 0 }), { code: "23514" });
      assert.equal((await db.query("delete from storage.objects where name = $1 returning id", [badMetadataPath])).rows.length, 1);
    });
  });

  it("makes likes persistent, unique, readable to B and editable only by the liking user", async () => {
    const like = (user: string) => db.query("insert into public.post_likes (post_id, user_id) values ($1, $2)", [post, user]);
    await asUser(ALICE, async () => {
      await like(ALICE);
      await assert.rejects(() => like(ALICE), { code: "23505" });
      await assert.rejects(() => like(BOB), { code: "42501" });
      await assert.rejects(() => db.query("update public.post_likes set user_id = $1", [BOB]), { code: "42501" });
    });
    await asUser(BOB, async () => {
      assert.equal((await db.query("select * from public.post_likes where post_id = $1", [post])).rows.length, 1);
      assert.equal((await db.query("delete from public.post_likes returning post_id")).rows.length, 0);
      await like(BOB);
    });
    await asUser(ALICE, async () => {
      assert.equal((await db.query("delete from public.post_likes returning post_id")).rows.length, 1);
      assert.deepEqual((await db.query("select user_id from public.post_likes")).rows, [{ user_id: BOB }]);
    });
  });

  it("creates owner atomically, allows join/leave and denies membership/ownership escalation", async () => {
    await asUser(ALICE, async () => {
      assert.deepEqual((await db.query("select user_id, role from public.community_members where community_id = $1", [group])).rows,
        [{ user_id: ALICE, role: "owner" }]);
      assert.equal((await db.query("delete from public.community_members where community_id = $1 returning user_id", [group])).rows.length, 0);
      await db.query("update public.communities set name = 'Renamed', description = 'Description' where id = $1", [group]);
      await assert.rejects(() => db.query("update public.communities set owner_id = $1 where id = $2", [BOB, group]), { code: "42501" });
      await assert.rejects(() => db.query("update public.communities set type = 'group' where id = $1", [channel]), { code: "42501" });
      await assert.rejects(() => scalar("select public.create_community('', '', 'group', null) as id", []), { code: "23514" });
    });
    await asUser(BOB, async () => {
      await db.query("insert into public.community_members (community_id, user_id) values ($1, $3), ($2, $3)", [group, channel, BOB]);
      assert.equal((await db.query("update public.communities set name = 'Stolen' where id = $1 returning id", [group])).rows.length, 0);
      await assert.rejects(() => db.query("update public.community_members set role = 'owner' where user_id = $1", [BOB]), { code: "42501" });
      await assert.rejects(() => db.query("insert into public.community_members (community_id, user_id, role) values ($1, $2, 'admin')",
        [group, EVE]), { code: "42501" });
      await assert.rejects(() => db.query("insert into public.community_members (community_id, user_id) values ($1, $2)", [group, EVE]), { code: "42501" });
      await assert.rejects(() => db.query("insert into public.communities (name, type, owner_id) values ('Forged', 'group', $1)", [BOB]), { code: "42501" });
      assert.equal((await db.query("delete from public.community_members where community_id = $1 returning user_id", [group])).rows.length, 1);
      await db.query("insert into public.community_members (community_id, user_id) values ($1, $2)", [group, BOB]);
    });
  });

  it("allows group members and channel owner/admin to publish, without moving existing posts", async () => {
    const publish = (author: string, community: string) => db.query(
      "insert into public.posts (author_id, content, community_id) values ($1, 'Community post', $2)", [author, community]);
    await asUser(ALICE, async () => {
      await publish(ALICE, group);
      await publish(ALICE, channel);
      await assert.rejects(() => db.query("update public.posts set community_id = $1 where id = $2", [channel, post]), { code: "42501" });
    });
    await asUser(BOB, async () => {
      await publish(BOB, group);
      await assert.rejects(() => publish(BOB, channel), { code: "42501" });
      await assert.rejects(() => publish(ALICE, channel), { code: "42501" });
      assert.equal((await db.query("select * from public.posts where community_id = $1", [channel])).rows.length, 1);
    });
    await asUser(EVE, async () => {
      await assert.rejects(() => publish(EVE, group), { code: "42501" });
      await assert.rejects(() => publish(EVE, channel), { code: "42501" });
    });
    // Admin assignment has no client grant/UI in this MVP; exercise its stored role.
    await db.query("update public.community_members set role = 'admin' where community_id = $1 and user_id = $2", [channel, BOB]);
    await asUser(BOB, () => publish(BOB, channel));
  });

  it("denies anonymous access to social data and private files", async () => {
    await asUser(null, async () => {
      for (const table of ["messages", "post_likes", "communities", "community_members"]) {
        await assert.rejects(() => db.query(`select * from public.${table}`), { code: "42501" });
      }
      assert.equal((await db.query("select * from storage.objects where bucket_id = 'message-files'")).rows.length, 0);
      await assert.rejects(() => scalar("select public.create_community('Anon', '', 'group', null) as id", []), { code: "42501" });
    }, "anon");
  });
});
