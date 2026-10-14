import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const EVE = "33333333-3333-4333-8333-333333333333";
const DAVE = "44444444-4444-4444-8444-444444444444";
const PHOTO = `${ALICE}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-photo.jpg`;
const DRAFT = `${ALICE}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaabb-draft.png`;

describe("Dating opt-in, private media and PostgreSQL permissions", { concurrency: false }, () => {
  let db: PGlite;
  let matchId: string;
  let chatId: string;
  async function asUser<T>(id: string | null, operation: () => Promise<T>, role = "authenticated") {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
    await db.exec(`set role ${role}`);
    try { return await operation(); } finally { await db.exec("reset role"); }
  }
  const save = (enabled = true, age: number | null = 20, paths: string[] = [], bio = "Dating only") =>
    db.query("select public.save_dating_profile($1,$2,$3,$4)", [enabled,bio,age,paths]);
  const candidates = () => db.query<{ user_id: string; score: number }>("select * from public.get_dating_candidates()");
  const react = async (target: string, reaction = "liked") =>
    (await db.query<{ id: string | null }>("select public.react_to_dating_profile($1,$2) id", [target,reaction])).rows[0].id;
  const block = (target: string, blocked = true) => db.query("select public.set_user_block($1,$2)",[target,blocked]);
  const chat = async (target: string) =>
    (await db.query<{ id: string }>("select public.get_or_create_direct_conversation($1) id",[target])).rows[0].id;
  const objects = () => db.query<{ name: string }>("select name from storage.objects where bucket_id = 'dating-photos' order by name");

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
      "202610020001_media_friends_music.sql", "202610070001_media_attachments.sql", "202610110001_group_chats.sql", "202610130001_reposts.sql", "202610130002_dating.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    }
    await db.query("insert into auth.users (id) values ($1),($2),($3),($4)", [ALICE,BOB,EVE,DAVE]);
  });
  after(async () => { await db?.close(); });

  it("defaults to no dating presence and requires authentication plus opt-in from both parties", async () => {
    assert.equal((await db.query("select * from public.dating_profiles")).rows.length, 0);
    await asUser(ALICE, async () => {
      assert.deepEqual((await candidates()).rows, []);
      await save(false);
      assert.equal((await db.query<{ enabled: boolean }>("select enabled from public.dating_profiles")).rows[0].enabled, false);
    });
    await asUser(BOB, async () => {
      await save();
      assert.deepEqual((await candidates()).rows, []);
      await assert.rejects(() => react(ALICE), { code: "42501" });
    });
    await asUser(EVE, async () => {
      assert.deepEqual((await candidates()).rows, []);
      assert.deepEqual((await db.query("select * from public.dating_profiles")).rows, []);
      await assert.rejects(() => react(BOB), { code: "42501" });
    });
    await asUser(null, async () => {
      await assert.rejects(() => save(), { code: "28000" });
      assert.deepEqual((await db.query("select * from public.dating_profiles")).rows, []);
    });
    await asUser(null, async () => {
      await assert.rejects(() => candidates(), { code: "42501" });
      await assert.rejects(() => db.query("select * from public.dating_profiles"), { code: "42501" });
      await assert.rejects(() => react(BOB), { code: "42501" });
    }, "anon");
  });

  it("keeps explicit dating photos private, validates metadata/ownership and revokes reads on opt-out", async () => {
    assert.equal((await db.query<{ public: boolean }>("select public from storage.buckets where id = 'dating-photos'")).rows[0].public, false);
    await asUser(ALICE, async () => {
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('dating-photos',$1,$2),('dating-photos',$3,$4)",
        [PHOTO,{mimetype:"image/jpeg",size:123},DRAFT,{mimetype:"image/png",size:30}]);
      await save(true,20,[PHOTO]);
      assert.equal((await objects()).rows.length, 2);
      await assert.rejects(() => save(true,20,[PHOTO,PHOTO]), {code:"22023"});
      await assert.rejects(() => save(true,20,[`${ALICE}/not-a-photo.jpg`]), {code:"42501"});
      await assert.rejects(() => save(true,20,[`${ALICE}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaacc-missing.jpg`]), {code:"23514"});
    });
    await asUser(BOB, async () => {
      assert.deepEqual((await objects()).rows,[{name:PHOTO}]);
      await assert.rejects(() => save(true,20,[PHOTO]), {code:"42501"});
      assert.equal((await db.query("delete from storage.objects where name = $1 returning name",[PHOTO])).rows.length,0);
      assert.equal((await db.query("update storage.objects set name = $1 where name = $2 returning name",[DRAFT,PHOTO])).rows.length,0);
    });
    await asUser(EVE, async () => {
      assert.deepEqual((await objects()).rows,[]);
      await assert.rejects(() => db.query("insert into storage.objects(bucket_id,name) values('dating-photos',$1)",[PHOTO]),{code:"42501"});
    });
    await asUser(null, async () => { assert.deepEqual((await objects()).rows,[]); },"anon");
    await asUser(ALICE, () => save(false,20,[PHOTO]));
    await asUser(BOB, async () => { assert.deepEqual((await objects()).rows,[]); });
    await db.query("update storage.objects set metadata = $1 where name = $2",[{mimetype:"image/png",size:123},PHOTO]);
    await asUser(ALICE, () => assert.rejects(() => save(true,20,[PHOTO]),{code:"23514"}));
    await db.query("update storage.objects set metadata = $1 where name = $2",[{mimetype:"image/jpeg",size:123},PHOTO]);
    await asUser(ALICE, () => save(true,20,[PHOTO]));
  });

  it("applies basic filters, existing interests and deterministic scoring without leaking main-profile bio", async () => {
    await asUser(EVE, () => save(true,null));
    await asUser(DAVE, () => save(true,25));
    await db.query("update public.profiles set specialty='Music',course=2,bio='Main profile only' where id in ($1,$2)",[ALICE,BOB]);
    await db.query("update public.profiles set specialty='Design',course=3 where id=$1",[DAVE]);
    const interest = (await db.query<{id:string}>("select id from public.interests order by id limit 1")).rows[0].id;
    await db.query("insert into public.profile_interests(profile_id,interest_id) values($1,$3),($2,$3)",[ALICE,BOB,interest]);
    await asUser(ALICE, async () => {
      const rows = (await candidates()).rows;
      assert.equal(rows[0].user_id,BOB);
      assert.equal(rows[0].score,6);
      const filtered = await db.query<{user_id:string;bio:string;interests:unknown[]}>(
        "select * from public.get_dating_candidates(19,22,2,'Music',$1,30)",[interest]);
      assert.equal(filtered.rows.length,1);
      assert.equal(filtered.rows[0].user_id,BOB);
      assert.equal(filtered.rows[0].bio,"Dating only");
      assert.equal(filtered.rows[0].interests.length,1);
      assert.equal((await db.query("select * from public.get_dating_candidates(30,40)")).rows.length,0);
    });
  });

  it("creates one mutual match, excludes reacted cards, preserves first reaction and reuses the direct chat", async () => {
    chatId = await asUser(ALICE, () => chat(BOB));
    assert.equal(await asUser(ALICE, () => react(BOB)),null);
    await asUser(ALICE, async () => {
      assert.equal((await candidates()).rows.some(r => r.user_id===BOB),false);
      assert.equal((await db.query("select * from public.dating_matches")).rows.length,0);
    });
    await asUser(BOB, async () => {
      assert.equal((await db.query("select * from public.dating_reactions")).rows.length,0);
      matchId = (await react(ALICE))!;
      assert.ok(matchId);
      assert.equal(await react(ALICE),matchId);
      assert.equal(await chat(ALICE),chatId);
      assert.equal((await db.query<{id:string}>("select id from public.dating_matches")).rows[0].id,matchId);
    });
    await asUser(ALICE, async () => {
      assert.equal(await react(BOB),matchId);
      assert.equal((await db.query<{id:string}>("select id from public.dating_matches")).rows[0].id,matchId);
      await react(EVE,"skipped");
      assert.equal(await react(EVE,"liked"),null);
      assert.equal((await candidates()).rows.some(r => r.user_id===EVE),false);
    });
    await asUser(EVE, async () => {
      await react(ALICE);
      assert.equal((await db.query("select * from public.dating_matches")).rows.length,0);
    });
    assert.equal((await db.query("select * from public.dating_matches")).rows.length,1);
    await assert.rejects(() => db.query("insert into public.dating_matches(user_a,user_b) values($1,$2)",[ALICE,BOB]),{code:"23505"});
    await assert.rejects(() => db.query("insert into public.dating_matches(user_a,user_b) values($1,$2)",[BOB,ALICE]),{code:"23514"});
    assert.equal((await db.query("select * from public.conversations")).rows.length,1);
    // PGlite has one session: verify shared lock presence, not real multiconnection scheduling.
    for (const fn of ["react_to_dating_profile(uuid,text)","set_user_block(uuid,boolean)","get_or_create_direct_conversation(uuid)"]) {
      assert.match((await db.query<{definition:string}>("select pg_get_functiondef($1::regprocedure) definition",[`public.${fn}`])).rows[0].definition,/pg_advisory_xact_lock/);
    }
  });

  it("enforces bidirectional blocks for cards, photos, matches and new chat starts while preserving old message RLS", async () => {
    await asUser(ALICE, () => block(BOB));
    for (const [actor,target] of [[ALICE,BOB],[BOB,ALICE]]) {
      await asUser(actor, async () => {
        assert.deepEqual((await db.query<{ids:string[]}>("select public.get_blocked_user_ids() ids")).rows[0].ids,[target]);
        assert.equal((await db.query("select * from public.dating_profiles where user_id=$1",[target])).rows.length,0);
        assert.equal((await db.query("select * from public.dating_matches")).rows.length,0);
        assert.equal((await candidates()).rows.some(r=>r.user_id===target),false);
        await assert.rejects(() => react(target),{code:"42501"});
        await assert.rejects(() => chat(target),{code:"42501"});
        assert.equal((await db.query("select id from public.conversations where id=$1",[chatId])).rows.length,1);
      });
    }
    await asUser(BOB, async () => {
      assert.deepEqual((await objects()).rows,[]);
      assert.equal((await db.query("select * from public.user_blocks")).rows.length,0);
      await block(ALICE,false); // Cannot remove Alice's block.
      await assert.rejects(() => chat(ALICE),{code:"42501"});
    });
    await asUser(EVE, async () => {
      assert.deepEqual((await db.query<{ids:string[]}>("select public.get_blocked_user_ids() ids")).rows[0].ids,[]);
      assert.equal((await db.query("select id from public.conversations where id=$1",[chatId])).rows.length,0);
      assert.equal((await db.query("select * from public.dating_matches")).rows.length,0);
    });
    await asUser(ALICE, () => block(BOB,false));
    await asUser(BOB, async () => {
      assert.equal(await chat(ALICE),chatId);
      assert.equal((await db.query("select * from public.dating_matches")).rows.length,1);
    });
    await asUser(ALICE, () => save(false,20,[PHOTO]));
    await asUser(BOB, async () => { assert.equal((await db.query("select * from public.dating_matches")).rows.length,0); });
    await asUser(ALICE, () => save(true,20,[PHOTO]));
  });

  it("stores private idempotent reports, hides reported cards and rejects spoofed direct writes", async () => {
    await asUser(ALICE, async () => {
      await db.query("select public.report_dating_profile($1,$2)",[DAVE,"Spam"]);
      await db.query("select public.report_dating_profile($1,$2)",[DAVE,"Retry"]);
      assert.equal((await candidates()).rows.some(r=>r.user_id===DAVE),false);
      assert.deepEqual((await db.query("select reporter_id,reported_id,reason from public.dating_reports")).rows,
        [{reporter_id:ALICE,reported_id:DAVE,reason:"Spam"}]);
      for (const table of ["dating_profiles","dating_reactions","dating_matches","user_blocks","dating_reports"]) {
        await assert.rejects(() => db.exec(`delete from public.${table}`),{code:"42501"});
      }
      await assert.rejects(() => db.query("insert into public.dating_profiles(user_id,enabled) values($1,true)",[BOB]),{code:"42501"});
      await assert.rejects(() => db.query("insert into public.dating_reactions(user_id,target_user_id,reaction) values($1,$2,'liked')",[BOB,EVE]),{code:"42501"});
      await assert.rejects(() => db.query("insert into public.dating_matches(user_a,user_b) values($1,$2)",[BOB,EVE]),{code:"42501"});
      await assert.rejects(() => db.query("insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",[BOB,EVE]),{code:"42501"});
      await assert.rejects(() => db.query("select public.report_dating_profile($1,'')",[DAVE]),{code:"22023"});
      await assert.rejects(() => react(ALICE),{code:"22023"});
      await assert.rejects(() => save(true,17),{code:"22023"});
    });
    await asUser(DAVE, async () => { assert.deepEqual((await db.query("select * from public.dating_reports")).rows,[]); });
  });
});
