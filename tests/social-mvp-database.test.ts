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
  let audioTrack: string;
  const audioPath = `${ALICE}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-track.mp3`;
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
    await db.exec(await readFile(new URL("../supabase/migrations/202610020001_media_friends_music.sql", import.meta.url), "utf8"));
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
      "application/zip", "application/x-zip-compressed", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a",
      "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]);
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

  it("registers only valid owned audio and shares registered tracks without granting ownership", async () => {
    const uploadAudio = (name: string, mime = "audio/mpeg", size = 12) => db.query(
      "insert into storage.objects (bucket_id, name, metadata) values ('audio', $1, $2)", [name, { mimetype: mime, size }]);
    const register = (file: string, owner = ALICE) => scalar(
      "insert into public.audio_tracks (owner_id, title, file_path) values ($1, 'Test audio', $2) returning id", [owner, file]);
    const bucket = (await db.query<{ public: boolean; file_size_limit: number }>("select * from storage.buckets where id = 'audio'")).rows[0];
    assert.equal(bucket.public, false);
    assert.equal(Number(bucket.file_size_limit), 50 * 1024 * 1024);
    await asUser(ALICE, async () => {
      await uploadAudio(audioPath);
      for (const invalid of [audioPath.replace(ALICE, BOB), `${ALICE}/../track.mp3`, audioPath.replace(".mp3", ".txt")]) {
        await assert.rejects(() => uploadAudio(invalid), { code: "42501" });
      }
      await assert.rejects(() => register(audioPath.replace("track.mp3", "missing.mp3")), { code: "23514" });
      for (const [name, mime, size] of [["large", "audio/mpeg", 52428801], ["empty", "audio/mpeg", 0],
        ["text", "text/plain", 12]] as const) {
        const invalid = audioPath.replace("track.mp3", `${name}.mp3`);
        await uploadAudio(invalid, mime, size);
        await assert.rejects(() => register(invalid), { code: "23514" });
      }
    });
    await asUser(BOB, async () => {
      assert.equal((await db.query("select * from storage.objects where bucket_id = 'audio' and name = $1", [audioPath])).rows.length, 0);
    });
    audioTrack = await asUser(ALICE, () => register(audioPath));
    await asUser(BOB, async () => {
      assert.equal((await db.query("select * from public.audio_tracks where id = $1", [audioTrack])).rows.length, 1);
      assert.equal((await db.query("select * from storage.objects where bucket_id = 'audio' and name = $1", [audioPath])).rows.length, 1);
      await assert.rejects(() => uploadAudio(audioPath), { code: "42501" });
      await assert.rejects(() => register(audioPath, BOB), { code: "42501" });
      await assert.rejects(() => register(audioPath, ALICE), { code: "42501" });
      assert.equal((await db.query("delete from storage.objects where bucket_id = 'audio' returning id")).rows.length, 0);
      assert.equal((await db.query("delete from public.audio_tracks where id = $1 returning id", [audioTrack])).rows.length, 0);
    });
    await asUser(ALICE, async () => {
      await assert.rejects(() => db.query("update public.audio_tracks set owner_id = $1 where id = $2", [BOB, audioTrack]), { code: "42501" });
      assert.equal((await db.query("update storage.objects set name = name where bucket_id = 'audio' returning id")).rows.length, 0);
    });
  });

  it("keeps playlists private while letting each owner add and remove shared tracks", async () => {
    const playlist = await asUser(ALICE, () => scalar(
      "insert into public.playlists (owner_id, name) values ($1, 'Private list') returning id", [ALICE]));
    const add = (id: string) => db.query("insert into public.playlist_tracks (playlist_id, track_id) values ($1, $2)", [id, audioTrack]);
    await asUser(ALICE, async () => {
      await add(playlist);
      await assert.rejects(() => add(playlist), { code: "23505" });
    });
    await asUser(BOB, async () => {
      assert.equal((await db.query("select * from public.playlists where id = $1", [playlist])).rows.length, 0);
      assert.equal((await db.query("select * from public.playlist_tracks where playlist_id = $1", [playlist])).rows.length, 0);
      await assert.rejects(() => add(playlist), { code: "42501" });
      await assert.rejects(() => db.query("insert into public.playlists (owner_id, name) values ($1, 'Forged')", [ALICE]), { code: "42501" });
      await assert.rejects(() => db.query("update public.playlists set name = 'Stolen' where id = $1", [playlist]), { code: "42501" });
      assert.equal((await db.query("delete from public.playlist_tracks where playlist_id = $1 returning track_id", [playlist])).rows.length, 0);
      assert.equal((await db.query("delete from public.playlists where id = $1 returning id", [playlist])).rows.length, 0);
      const own = await scalar("insert into public.playlists (owner_id, name) values ($1, 'My list') returning id", [BOB]);
      await add(own);
      assert.equal((await db.query("select * from public.playlist_tracks where playlist_id = $1", [own])).rows.length, 1);
      assert.equal((await db.query("delete from public.playlist_tracks where playlist_id = $1 returning track_id", [own])).rows.length, 1);
      assert.equal((await db.query("delete from public.playlists where id = $1 returning id", [own])).rows.length, 1);
    });
    await asUser(ALICE, async () => {
      assert.equal((await db.query("delete from public.playlist_tracks where playlist_id = $1 returning track_id", [playlist])).rows.length, 1);
      assert.equal((await db.query("delete from public.playlists where id = $1 returning id", [playlist])).rows.length, 1);
    });
  });

  it("accepts audio messages for participants without exposing their private files to the music library", async () => {
    for (const [extension, mime] of [["mp3", "audio/mpeg"], ["m4a", "audio/mp4"], ["wav", "audio/wav"]]) {
      const audioMessage = path().replace("notes.txt", `voice.${extension}`);
      await asUser(ALICE, async () => {
        await upload(audioMessage, mime);
        await attach({ filePath: audioMessage, name: `voice.${extension}`, mime });
      });
      await asUser(BOB, async () => {
        assert.equal((await db.query("select * from public.messages where attachment_path = $1", [audioMessage])).rows.length, 1);
        assert.equal((await db.query("select * from storage.objects where bucket_id = 'message-files' and name = $1", [audioMessage])).rows.length, 1);
        assert.equal((await db.query("delete from storage.objects where name = $1 returning id", [audioMessage])).rows.length, 0);
      });
      await asUser(EVE, async () => {
        assert.equal((await db.query("select * from public.audio_tracks where id = $1", [audioTrack])).rows.length, 1);
        assert.equal((await db.query("select * from public.messages where attachment_path = $1", [audioMessage])).rows.length, 0);
        assert.equal((await db.query("select * from storage.objects where name = $1", [audioMessage])).rows.length, 0);
        await assert.rejects(() => attach({ filePath: audioMessage, name: `voice.${extension}`, mime, sender: EVE }), { code: "42501" });
      });
    }
  });

  it("keeps friendship requests private and lets only the recipient accept an immutable pair", async () => {
    let friendship: string;
    await asUser(ALICE, async () => {
      friendship = await scalar("insert into public.friendships (requester_id, addressee_id) values ($1, $2) returning id", [ALICE, BOB]);
      assert.deepEqual((await db.query("select requester_id, addressee_id, status from public.friendships where id = $1", [friendship])).rows,
        [{ requester_id: ALICE, addressee_id: BOB, status: "pending" }]);
      await assert.rejects(() => db.query("insert into public.friendships (requester_id, addressee_id) values ($1, $2)",
        [ALICE, BOB]), { code: "23505" });
      await assert.rejects(() => db.query("insert into public.friendships (requester_id, addressee_id) values ($1, $1)",
        [ALICE]), { code: "23514" });
      assert.equal((await db.query("update public.friendships set status = 'accepted' where id = $1 returning id", [friendship])).rows.length, 0);
    });
    await asUser(EVE, async () => {
      assert.equal((await db.query("select * from public.friendships")).rows.length, 0);
      assert.equal((await db.query("update public.friendships set status = 'accepted' returning id")).rows.length, 0);
      assert.equal((await db.query("delete from public.friendships returning id")).rows.length, 0);
      await assert.rejects(() => db.query("insert into public.friendships (requester_id, addressee_id) values ($1, $2)",
        [ALICE, EVE]), { code: "42501" });
      await assert.rejects(() => db.query("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')",
        [EVE, ALICE]), { code: "42501" });
    });
    await asUser(BOB, async () => {
      assert.equal((await db.query("select * from public.friendships where id = $1", [friendship])).rows.length, 1);
      await assert.rejects(() => db.query("insert into public.friendships (requester_id, addressee_id) values ($1, $2)",
        [BOB, ALICE]), { code: "23505" });
      for (const column of ["id", "requester_id", "addressee_id"]) {
        await assert.rejects(() => db.query(`update public.friendships set ${column} = $1 where id = $2`, [EVE, friendship]), { code: "42501" });
      }
      await assert.rejects(() => db.query("update public.friendships set created_at = now(), updated_at = now() where id = $1",
        [friendship]), { code: "42501" });
      await assert.rejects(() => db.query("update public.friendships set status = 'pending' where id = $1", [friendship]), { code: "42501" });
      const accepted = (await db.query<{ status: string; updated_at: string; created_at: string }>(
        "update public.friendships set status = 'accepted' where id = $1 returning status, updated_at, created_at", [friendship])).rows[0];
      assert.equal(accepted.status, "accepted");
      assert.ok(new Date(accepted.updated_at).getTime() >= new Date(accepted.created_at).getTime());
      assert.equal((await db.query("update public.friendships set status = 'pending' where id = $1 returning id", [friendship])).rows.length, 0);
    });
    await asUser(ALICE, async () => {
      assert.equal((await db.query<{ status: string }>("select status from public.friendships where id = $1", [friendship])).rows[0].status, "accepted");
      assert.equal((await db.query("delete from public.friendships where id = $1 returning id", [friendship])).rows.length, 1);
    });
  });

  it("allows request cancellation, rejection and a new request after removal", async () => {
    const request = () => scalar("insert into public.friendships (requester_id, addressee_id) values ($1, $2) returning id", [ALICE, BOB]);
    const remove = (id: string) => db.query("delete from public.friendships where id = $1 returning id", [id]);
    let friendship = await asUser(ALICE, request);
    assert.equal((await asUser(ALICE, () => remove(friendship))).rows.length, 1);
    friendship = await asUser(ALICE, request);
    assert.equal((await asUser(BOB, () => remove(friendship))).rows.length, 1);
    friendship = await asUser(ALICE, request);
    await asUser(BOB, async () => {
      await db.query("update public.friendships set status = 'accepted' where id = $1", [friendship]);
      assert.equal((await remove(friendship)).rows.length, 1);
    });
    await asUser(ALICE, async () => { assert.equal((await db.query("select * from public.friendships")).rows.length, 0); });
  });

  it("denies anonymous access to social data and private files", async () => {
    await asUser(null, async () => {
      for (const table of ["messages", "post_likes", "communities", "community_members", "friendships", "audio_tracks", "playlists", "playlist_tracks"]) {
        await assert.rejects(() => db.query(`select * from public.${table}`), { code: "42501" });
      }
      assert.equal((await db.query("select * from storage.objects where bucket_id in ('message-files', 'audio')")).rows.length, 0);
      await assert.rejects(() => scalar("select public.create_community('Anon', '', 'group', null) as id", []), { code: "42501" });
    }, "anon");
  });
});
