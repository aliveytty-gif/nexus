import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const EVE = "44444444-4444-4444-8444-444444444444";
const DAVE = "55555555-5555-4555-8555-555555555555";
const MISSING = "99999999-9999-4999-8999-999999999999";
const FILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-photo.jpg";

type Invitation = {
  conversation_id: string;
  title: string;
  inviter_id: string;
  inviter_username: string;
  inviter_first_name: string;
  inviter_last_name: string;
  created_at: Date;
};

describe("Group invitations PostgreSQL consent and permissions", { concurrency: false }, () => {
  let db: PGlite;
  let direct: string;
  let legacyGroup: string;
  let legacyMessage: string;

  async function asUser<T>(id: string | null, operation: () => Promise<T>, role = "authenticated") {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    await db.exec(`set role ${role}`);
    try { return await operation(); } finally { await db.exec("reset role"); }
  }
  async function create(members = [BOB], title = "Consent group") {
    return (await db.query<{ id: string }>("select public.create_group_conversation($1, $2) as id", [title, members])).rows[0].id;
  }
  const manage = (id: string, target: string, action: string) =>
    db.query("select public.manage_group_member($1, $2, $3)", [id, target, action]);
  const respond = (id: string, accept: boolean) => db.query("select public.respond_to_group_invitation($1, $2)", [id, accept]);
  const invitations = () => db.query<Invitation>("select * from public.get_group_invitations()");
  const block = (target: string, blocked: boolean) => db.query("select public.set_user_block($1, $2)", [target, blocked]);
  const leave = (id: string) => db.query("select public.leave_group_conversation($1)", [id]);
  const members = (id: string) => db.query<{ user_id: string; role: string }>(
    "select user_id, role from public.conversation_members where conversation_id = $1 order by user_id", [id]);
  const pending = (id: string) => db.query<{ invitee_id: string; inviter_id: string; created_at: string }>(
    "select invitee_id, inviter_id, created_at::text from public.group_invitations where conversation_id = $1 order by invitee_id", [id]);
  async function send(id: string, sender = ALICE, attachments: object[] = []) {
    return (await db.query<{ id: string }>(
      "insert into public.messages (conversation_id, sender_id, body, attachments) values ($1, $2, 'Private history', $3) returning id",
      [id, sender, JSON.stringify(attachments)])).rows[0].id;
  }
  async function withBlock(blocker: string, target: string, operation: () => Promise<void>) {
    await asUser(blocker, () => block(target, true));
    try { await operation(); } finally { await asUser(blocker, () => block(target, false)); }
  }

  before(async () => {
    db = new PGlite();
    // Emulate Auth/Storage interfaces only; actual migrations, ACLs and RLS run in PostgreSQL.
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
      "202609240001_social_mvp.sql", "202610020001_media_friends_music.sql", "202610070001_media_attachments.sql",
      "202610110001_group_chats.sql", "202610130002_dating.sql", "202610300001_private_message_uploads.sql",
      "202611020001_group_contact_safety.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    }
    await db.query("insert into auth.users (id) values ($1), ($2), ($3), ($4), ($5)", [ALICE, BOB, CAROL, EVE, DAVE]);
    await db.query("update public.profiles set username = 'alice', first_name = 'Alice', last_name = 'Creator' where id = $1", [ALICE]);
    direct = await asUser(ALICE, async () => (await db.query<{ id: string }>(
      "select public.get_or_create_direct_conversation($1) as id", [BOB])).rows[0].id);
    // Preserve a real pre-consent group through the upgrade, rather than rebuilding it as invitations.
    legacyGroup = await asUser(ALICE, () => create([BOB, CAROL], "Existing group"));
    legacyMessage = await asUser(BOB, () => send(legacyGroup, BOB));
    await db.exec(await readFile(new URL("../supabase/migrations/202611020002_group_invitations.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/202611130001_message_send_retry.sql", import.meta.url), "utf8"));
  });
  after(async () => { await db?.close(); });

  it("creates only the creator's membership and deduplicated recipient invitations", async () => {
    const id = await asUser(ALICE, () => create([ALICE, BOB, BOB, CAROL], "  Invitation preview  "));
    assert.deepEqual((await members(id)).rows, [{ user_id: ALICE, role: "creator" }]);
    assert.deepEqual((await pending(id)).rows.map(({ invitee_id, inviter_id }) => ({ invitee_id, inviter_id })),
      [{ invitee_id: BOB, inviter_id: ALICE }, { invitee_id: CAROL, inviter_id: ALICE }]);
    await asUser(BOB, async () => {
      const row = (await invitations()).rows.find((invitation) => invitation.conversation_id === id);
      assert.ok(row);
      assert.deepEqual(Object.keys(row).sort(), ["conversation_id", "created_at", "inviter_first_name", "inviter_id",
        "inviter_last_name", "inviter_username", "title"]);
      assert.equal(row.title, "Invitation preview");
      assert.equal(row.inviter_id, ALICE);
      assert.equal(row.inviter_username, "alice");
      assert.equal(row.inviter_first_name, "Alice");
      assert.equal(row.inviter_last_name, "Creator");
      assert.deepEqual((await db.query("select invitee_id from public.group_invitations where conversation_id = $1", [id])).rows,
        [{ invitee_id: BOB }]);
    });
    for (const user of [ALICE, EVE]) await asUser(user, async () => {
      assert.equal((await invitations()).rows.some((invitation) => invitation.conversation_id === id), false);
      assert.equal((await db.query("select * from public.group_invitations where conversation_id = $1", [id])).rows.length, 0);
    });
  });

  it("gives pending recipients no history, membership, avatar, file, send or management access", async () => {
    const id = await asUser(ALICE, () => create());
    const path = `${id}/${ALICE}/${FILE}`;
    let message: string;
    await asUser(ALICE, async () => {
      await db.query("insert into storage.objects (bucket_id, name, metadata) values ('message-files', $1, $2)",
        [path, { mimetype: "image/jpeg", size: 12 }]);
      await db.query("select public.update_group_conversation($1, 'Private group', $2)", [id, path]);
      message = await send(id, ALICE, [{ path, name: "photo.jpg", type: "image/jpeg", size: 12 }]);
    });
    await asUser(BOB, async () => {
      for (const [table, column] of [["conversations", "id"], ["messages", "conversation_id"], ["conversation_members", "conversation_id"]]) {
        assert.equal((await db.query(`select * from public.${table} where ${column} = $1`, [id])).rows.length, 0);
      }
      assert.equal((await db.query("select id from storage.objects where name = $1", [path])).rows.length, 0);
      assert.equal((await db.query("select id from public.get_conversation_summaries() where id = $1", [id])).rows.length, 0);
      await assert.rejects(() => send(id, BOB), { code: "42501" });
      await assert.rejects(() => db.query("insert into storage.objects (bucket_id, name) values ('message-files', $1)",
        [`${id}/${BOB}/${FILE}`]), { code: "42501" });
      await assert.rejects(() => manage(id, BOB, "add"), { code: "42501" });
      await assert.rejects(() => db.query("select public.update_group_conversation($1, 'Bypass', null)", [id]), { code: "42501" });
      await assert.rejects(() => db.query("select public.mark_conversation_read($1, $2)", [id, message!]), { code: "42501" });
      await assert.rejects(() => leave(id), { code: "42501" });
      await respond(id, true);
      assert.equal((await db.query("select id from public.messages where id = $1", [message!])).rows.length, 1);
      assert.equal((await db.query("select id from storage.objects where name = $1", [path])).rows.length, 1);
    });
  });

  it("binds responses to the session recipient and keeps accept/decline retries harmless", async () => {
    const id = await asUser(ALICE, () => create([BOB, CAROL]));
    for (const user of [ALICE, EVE]) await asUser(user, async () => {
      await respond(id, true);
      await respond(id, false);
    });
    assert.equal((await pending(id)).rows.length, 2);
    await asUser(BOB, async () => { await respond(id, true); await respond(id, true); await respond(id, false); });
    assert.deepEqual((await members(id)).rows, [{ user_id: ALICE, role: "creator" }, { user_id: BOB, role: "member" }]);
    assert.deepEqual((await pending(id)).rows.map((row) => row.invitee_id), [CAROL]);
    await asUser(CAROL, async () => { await respond(id, false); await respond(id, false); await respond(id, true); });
    assert.equal((await pending(id)).rows.length, 0);
    assert.equal((await members(id)).rows.some((row) => row.user_id === CAROL), false);
    await asUser(EVE, async () => { await respond(MISSING, true); await respond(MISSING, false); });
  });

  it("rejects forged invitation/membership writes and anonymous or sessionless RPC calls", async () => {
    const id = await asUser(ALICE, () => create());
    await asUser(BOB, async () => {
      for (const sql of [
        "insert into public.group_invitations (conversation_id, invitee_id, inviter_id) values ($1, $2, $3)",
        "update public.group_invitations set invitee_id = $2, inviter_id = $3 where conversation_id = $1",
        "delete from public.group_invitations where conversation_id = $1 and invitee_id = $2 and inviter_id = $3",
        "insert into public.conversation_members (conversation_id, user_id, role) values ($1, $2, 'creator') returning $3::uuid",
      ]) await assert.rejects(() => db.query(sql, [id, BOB, ALICE]), { code: "42501" });
    });
    await asUser(null, async () => {
      await assert.rejects(() => invitations(), { code: "42501" });
      await assert.rejects(() => respond(id, true), { code: "42501" });
      await assert.rejects(() => create(), { code: "42501" });
      await assert.rejects(() => manage(id, BOB, "add"), { code: "42501" });
      await assert.rejects(() => db.query("select * from public.group_invitations"), { code: "42501" });
    }, "anon");
    await asUser(null, async () => {
      await assert.rejects(() => invitations(), { code: "28000" });
      await assert.rejects(() => respond(id, true), { code: "28000" });
    });
    assert.equal((await pending(id)).rows.length, 1);
    assert.equal((await members(id)).rows.length, 1);
  });

  it("keeps duplicate invitations unchanged and does not invite oneself or existing members", async () => {
    const id = await asUser(ALICE, () => create());
    await db.query("update public.group_invitations set created_at = '2026-01-01' where conversation_id = $1", [id]);
    const before = (await pending(id)).rows;
    await asUser(ALICE, async () => { await manage(id, BOB, "add"); await manage(id, ALICE, "add"); });
    assert.deepEqual((await pending(id)).rows, before);
    await asUser(BOB, () => respond(id, true));
    await asUser(ALICE, async () => { await manage(id, BOB, "add"); await manage(id, BOB, "promote"); });
    await asUser(BOB, () => manage(id, CAROL, "add"));
    await db.query("update public.group_invitations set created_at = '2026-01-01' where conversation_id = $1", [id]);
    const fromAdmin = (await pending(id)).rows;
    await asUser(ALICE, () => manage(id, CAROL, "add"));
    assert.deepEqual((await pending(id)).rows, fromAdmin);
    assert.equal(fromAdmin[0].inviter_id, BOB);
    assert.equal((await members(id)).rows.some((row) => row.user_id === CAROL), false);
    await asUser(CAROL, () => respond(id, true));
    await asUser(CAROL, () => assert.rejects(() => manage(id, EVE, "add"), { code: "42501" }));
    await asUser(ALICE, async () => {
      await manage(id, BOB, "demote");
      await manage(id, CAROL, "remove");
    });
    assert.deepEqual((await members(id)).rows, [{ user_id: ALICE, role: "creator" }, { user_id: BOB, role: "member" }]);
  });

  it("validates inputs without creating partial groups or invitations", async () => {
    const counts = async () => (await db.query(`select
      (select count(*) from public.conversations) as groups,
      (select count(*) from public.conversation_members) as members,
      (select count(*) from public.group_invitations) as invitations`)).rows;
    const before = await counts();
    await asUser(ALICE, async () => {
      for (const title of ["", " \n\t", "x".repeat(101)]) await assert.rejects(() => create([BOB], title), { code: "22023" });
      for (const users of [[], [ALICE]]) await assert.rejects(() => create(users), { code: "22023" });
      await assert.rejects(() => create([MISSING]), { code: "P0002" });
      await assert.rejects(() => db.query("select public.create_group_conversation('Null target', array[null]::uuid[])"), { code: "22023" });
      await assert.rejects(() => db.query("select public.respond_to_group_invitation(null, true)"), { code: "22023" });
      await assert.rejects(() => db.query("select public.respond_to_group_invitation($1, null)", [legacyGroup]), { code: "22023" });
    });
    assert.deepEqual(await counts(), before);
  });

  it("preserves both-direction and third-party block checks before creating invitations", async () => {
    const counts = async () => (await db.query(`select
      (select count(*) from public.conversations) as groups,
      (select count(*) from public.group_invitations) as invitations`)).rows;
    for (const [blocker, target] of [[ALICE, BOB], [BOB, ALICE]]) await withBlock(blocker, target, async () => {
      const before = await counts();
      await asUser(ALICE, () => assert.rejects(() => create([BOB]), { code: "42501" }));
      await asUser(EVE, () => assert.rejects(() => create([ALICE, BOB]), { code: "42501" }));
      assert.deepEqual(await counts(), before);
    });
  });

  it("checks invitations from creators/admins against all current members in both block directions", async () => {
    const id = await asUser(ALICE, () => create());
    await asUser(BOB, () => respond(id, true));
    await asUser(ALICE, () => manage(id, BOB, "promote"));
    for (const [blocker, target] of [[BOB, CAROL], [CAROL, BOB]]) await withBlock(blocker, target, async () => {
      for (const manager of [ALICE, BOB]) await asUser(manager, () => assert.rejects(() => manage(id, CAROL, "add"), { code: "42501" }));
      assert.equal((await pending(id)).rows.length, 0);
    });
    await asUser(ALICE, async () => {
      await assert.rejects(() => manage(id, MISSING, "add"), { code: "P0002" });
      await assert.rejects(() => manage(id, CAROL, "unknown"), { code: "22023" });
      await manage(id, CAROL, "add");
    });
    assert.deepEqual((await pending(id)).rows.map((row) => row.invitee_id), [CAROL]);
    assert.equal((await members(id)).rows.length, 2);
  });

  it("rechecks blocks after invitation and permits decline even after blocking", async () => {
    for (const [blocker, target] of [[BOB, ALICE], [ALICE, BOB]]) {
      const id = await asUser(ALICE, () => create());
      await withBlock(blocker, target, async () => {
        await asUser(BOB, () => assert.rejects(() => respond(id, true), { code: "42501" }));
        assert.equal((await pending(id)).rows.length, 1);
        assert.equal((await members(id)).rows.length, 1);
        await asUser(BOB, () => respond(id, false));
        assert.equal((await pending(id)).rows.length, 0);
      });
      await asUser(BOB, () => respond(id, true));
      assert.equal((await members(id)).rows.length, 1, "Declined invitation cannot be accepted later");
      await asUser(ALICE, () => manage(id, BOB, "add"));
      await asUser(BOB, () => respond(id, true));
      assert.equal((await members(id)).rows.length, 2);
    }
  });

  it("rechecks acceptance against every existing member, not only the inviter", async () => {
    for (const [blocker, target] of [[BOB, CAROL], [CAROL, BOB]]) {
      const id = await asUser(ALICE, () => create([BOB, CAROL]));
      await asUser(BOB, () => respond(id, true));
      await withBlock(blocker, target, async () => {
        await asUser(CAROL, () => assert.rejects(() => respond(id, true), { code: "42501" }));
        assert.equal((await pending(id)).rows.some((row) => row.invitee_id === CAROL), true);
        assert.equal((await members(id)).rows.length, 2);
      });
      await asUser(CAROL, () => respond(id, true));
      assert.equal((await members(id)).rows.length, 3);
    }
  });

  it("refuses acceptance while an invitation's original manager is demoted", async () => {
    const id = await asUser(ALICE, () => create());
    await asUser(BOB, () => respond(id, true));
    await asUser(ALICE, () => manage(id, BOB, "promote"));
    await asUser(BOB, () => manage(id, CAROL, "add"));
    await asUser(ALICE, () => manage(id, BOB, "demote"));
    await asUser(CAROL, () => assert.rejects(() => respond(id, true), { code: "42501" }));
    assert.equal((await members(id)).rows.length, 2);
    assert.equal((await pending(id)).rows[0].inviter_id, BOB);
    await asUser(ALICE, () => manage(id, BOB, "promote"));
    await asUser(CAROL, () => respond(id, true));
    assert.equal((await members(id)).rows.length, 3);
  });

  it("cascades pending invitations on inviter removal, creator departure and group deletion", async () => {
    const id = await asUser(ALICE, () => create());
    await asUser(BOB, () => respond(id, true));
    await asUser(ALICE, () => manage(id, BOB, "promote"));
    await asUser(BOB, () => manage(id, CAROL, "add"));
    await asUser(ALICE, () => manage(id, BOB, "remove"));
    assert.equal((await pending(id)).rows.length, 0);
    await asUser(CAROL, () => respond(id, true));
    assert.equal((await members(id)).rows.some((row) => row.user_id === CAROL), false);

    const inherited = await asUser(ALICE, () => create([BOB, CAROL]));
    await asUser(BOB, () => respond(inherited, true));
    await asUser(ALICE, () => leave(inherited));
    assert.deepEqual((await members(inherited)).rows, [{ user_id: BOB, role: "creator" }]);
    assert.equal((await pending(inherited)).rows.length, 0);

    const empty = await asUser(ALICE, () => create());
    await asUser(ALICE, () => leave(empty));
    assert.equal((await db.query("select id from public.conversations where id = $1", [empty])).rows.length, 0);
    assert.equal((await pending(empty)).rows.length, 0);
    await asUser(BOB, () => respond(empty, true));
    assert.equal((await members(empty)).rows.length, 0);
  });

  it("preserves legacy memberships/history, direct-chat behavior and existing-role restrictions", async () => {
    assert.deepEqual((await members(legacyGroup)).rows, [
      { user_id: ALICE, role: "creator" }, { user_id: BOB, role: "member" }, { user_id: CAROL, role: "member" },
    ]);
    assert.equal((await pending(legacyGroup)).rows.length, 0);
    await asUser(BOB, async () => {
      assert.equal((await db.query("select id from public.messages where id = $1", [legacyMessage])).rows.length, 1);
      await send(legacyGroup, BOB);
      assert.equal((await db.query<{ id: string }>("select public.get_or_create_direct_conversation($1) as id", [ALICE])).rows[0].id, direct);
      await assert.rejects(() => manage(legacyGroup, BOB, "promote"), { code: "42501" });
      await assert.rejects(() => manage(direct, CAROL, "add"), { code: "42501" });
    });
    await asUser(CAROL, () => respond(direct, true));
    assert.equal((await members(direct)).rows.length, 2);
    await asUser(ALICE, async () => {
      await assert.rejects(() => manage(legacyGroup, ALICE, "remove"), { code: "42501" });
      await manage(legacyGroup, BOB, "promote");
    });
    await asUser(BOB, () => assert.rejects(() => manage(legacyGroup, CAROL, "promote"), { code: "42501" }));
    await withBlock(BOB, ALICE, async () => {
      await asUser(ALICE, () => assert.rejects(() => manage(legacyGroup, BOB, "add"), { code: "42501" }));
      await asUser(BOB, async () => {
        assert.equal((await db.query("select id from public.messages where id = $1", [legacyMessage])).rows.length, 1);
      });
    });
  });

  it("bounds the recipient preview at 50 and orders the newest invitations first", async () => {
    await asUser(ALICE, async () => {
      for (let index = 0; index < 52; index++) await create([DAVE], `Bounded invitation ${index}`);
    });
    const expected = await db.query<{ conversation_id: string }>(`select conversation_id from public.group_invitations
      where invitee_id = $1 order by created_at desc, conversation_id limit 50`, [DAVE]);
    await asUser(DAVE, async () => {
      const listed = (await invitations()).rows;
      assert.equal(listed.length, 50);
      assert.deepEqual(listed.map((row) => row.conversation_id), expected.rows.map((row) => row.conversation_id));
      assert.ok(listed.every((row) => row.inviter_id === ALICE));
      assert.equal((await db.query("select * from public.conversations where id = any($1::uuid[])",
        [listed.map((row) => row.conversation_id)])).rows.length, 0);
    });
  });

  it("applies send retry support without changing existing messages or legacy inserts", async () => {
    const existing = await db.query("select client_nonce from public.messages where id = $1", [legacyMessage]);
    assert.deepEqual(existing.rows, [{ client_nonce: null }]);
    const legacyInsert = await asUser(ALICE, () => send(direct));
    assert.notEqual(legacyInsert, legacyMessage);
  });

  async function sendWithNonce(conversation: string, nonce: string | null, body: string, attachments: object[] = []) {
    return (await db.query<{ id: string }>("select public.send_message($1, $2, $3, $4) as id",
      [conversation, nonce, body, JSON.stringify(attachments)])).rows[0].id;
  }

  it("reuses one message, preserves its payload, and lets new nonces send identical text", async () => {
    const nonce = "aaaaaaaa-1111-4111-8111-111111111111";
    await asUser(ALICE, async () => {
      const first = await sendWithNonce(direct, nonce, "Repeatable");
      assert.equal(await sendWithNonce(direct, nonce, "Repeatable"), first);
      await assert.rejects(() => sendWithNonce(direct, nonce, "Different"), { code: "23505" });
      assert.deepEqual((await db.query("select body from public.messages where id = $1", [first])).rows,
        [{ body: "Repeatable" }]);
      assert.notEqual(await sendWithNonce(direct, "bbbbbbbb-1111-4111-8111-111111111111", "Repeatable"), first);
    });
  });

  it("scopes a nonce to sender and conversation and retains Auth and membership checks", async () => {
    const nonce = "cccccccc-1111-4111-8111-111111111111";
    const aliceId = await asUser(ALICE, () => sendWithNonce(direct, nonce, "Alice"));
    const bobId = await asUser(BOB, () => sendWithNonce(direct, nonce, "Bob"));
    const groupId = await asUser(ALICE, () => sendWithNonce(legacyGroup, nonce, "Group"));
    assert.equal(new Set([aliceId, bobId, groupId]).size, 3);
    await asUser(EVE, () => assert.rejects(() => sendWithNonce(direct, nonce, "Alice"), { code: "42501" }));
    await asUser(null, () => assert.rejects(() => sendWithNonce(direct, nonce, "Alice"), { code: "42501" }), "anon");
    await asUser(ALICE, () => assert.rejects(() => sendWithNonce(direct, null, "Alice"), { code: "22023" }));
  });

  it("keeps uploaded files attached to the original send and can retry after validation failure", async () => {
    const nonce = "dddddddd-1111-4111-8111-111111111111";
    const path = `${direct}/${ALICE}/${FILE}`;
    const attachments = [{ path, name: "photo.jpg", type: "image/jpeg", size: 13 }];
    await asUser(ALICE, () => assert.rejects(() => sendWithNonce(direct, nonce, "", attachments), { code: "23514" }));
    await db.query("insert into storage.objects (bucket_id, name, metadata) values ('message-files', $1, $2)",
      [path, JSON.stringify({ mimetype: "image/jpeg", size: 13 })]);
    const original = await asUser(ALICE, () => sendWithNonce(direct, nonce, "", attachments));
    await db.query("delete from storage.objects where bucket_id = 'message-files' and name = $1", [path]);
    assert.equal(await asUser(ALICE, () => sendWithNonce(direct, nonce, "", attachments)), original);
    assert.deepEqual((await db.query("select attachments from public.messages where id = $1", [original])).rows,
      [{ attachments }]);
  });
});
