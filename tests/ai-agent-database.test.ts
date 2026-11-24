import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const T = "33333333-3333-4333-8333-333333333333", Q = "44444444-4444-4444-8444-444444444444", R = "55555555-5555-4555-8555-555555555555";
const R2 = "66666666-6666-4666-8666-666666666666";

describe("AI agent history, RLS and atomic quotas", { concurrency: false }, () => {
  let db: PGlite;
  before(async () => {
    db = new PGlite();
    await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      alter default privileges in schema public grant all on tables to anon,authenticated;
      alter default privileges in schema public grant all on functions to anon,authenticated;`);
    for (const name of ["202610220001_ai_quotas.sql", "202611130002_ai_agent.sql", "202611170001_ai_quota_ceiling.sql"])
      await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
  });
  after(async () => db?.close());
  beforeEach(async () => {
    await db.exec(`reset role; truncate auth.users cascade;
      update public.ai_global_usage set attempts=0,recent_attempts='{}',usage_day=(clock_timestamp() at time zone 'UTC')::date;
      update public.ai_quota_settings set user_limit=5,global_limit=40;`);
    await db.query("insert into auth.users values($1),($2)", [A,B]);
  });
  async function as<T>(id: string | null, query: () => Promise<T>) {
    await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || ""]);
    await db.exec("set role authenticated"); try { return await query(); } finally { await db.exec("reset role"); }
  }
  async function begin(id=A, run=R, turn=Q, thread=T, question="Вопрос") {
    return as(id, async () => (await db.query<{v:{replay:boolean;turn:{run_id:string;answer:string}}}>("select public.begin_ai_turn($1,$2,$3,$4,'auto') v",[thread,turn,run,question])).rows[0].v);
  }
  async function step(id=A,run=R) {
    return as(id,async () => (await db.query<{v:{allowed:boolean;code?:string;user_remaining:number}}>("select public.reserve_ai_agent_step($1,$2,50,50) v",[Q,run])).rows[0].v);
  }
  async function finish(id=A,run=R,status="complete",answer="Ответ") {
    return as(id,async () => (await db.query<{v:boolean}>("select public.finish_ai_turn($1,$2,$3,$4,'[]','[]','{}') v",[Q,run,status,answer])).rows[0].v);
  }
  it("replays the same request without duplicating question or re-running work",async () => {
    assert.equal((await begin()).replay,false); assert.equal((await begin()).replay,true);
    assert.equal((await step()).user_remaining,4); await finish();
    const replay=await begin(); assert.equal(replay.replay,true); assert.equal(replay.turn.answer,"Ответ");
    assert.equal((await db.query<{n:number}>("select count(*)::int n from public.ai_turns")).rows[0].n,1);
  });
  it("isolates history, memory and deletion across users",async () => {
    await begin();
    const hidden=await as(B,()=>db.query("select * from public.ai_turns")); assert.equal(hidden.rows.length,0);
    assert.equal((await as(B,()=>db.query("delete from public.ai_threads returning id"))).rows.length,0);
    await assert.rejects(begin(B,R2),/Not found/);
    await assert.rejects(step(B),/Run unavailable/);
    assert.equal(await finish(B),false);
    await as(A,()=>db.query("delete from public.ai_threads where id=$1",[T]));
    assert.equal((await db.query("select * from public.ai_turns")).rows.length,0);
    assert.equal(await finish(),false);
  });
  it("rejects direct turn/thread writes and anonymous access",async () => {
    await begin();
    await assert.rejects(as(A,()=>db.exec("update public.ai_turns set answer='forged'")),/permission denied/);
    await assert.rejects(as(A,()=>db.exec("update public.ai_threads set user_id='22222222-2222-4222-8222-222222222222'")),/permission denied/);
    await assert.rejects(as(null,()=>db.query("select public.begin_ai_turn($1,$2,$3,'q','auto')",[T,Q,R])),/Authentication required/);
    await db.exec("set role anon");
    try { await assert.rejects(db.exec("select * from public.ai_turns"),/permission denied/); } finally { await db.exec("reset role"); }
  });
  it("prevents concurrent runs, including on different threads",async () => {
    await begin();
    await assert.rejects(begin(A,R2,"77777777-7777-4777-8777-777777777777","88888888-8888-4888-8888-888888888888"),/AI busy/);
    await assert.rejects(begin(A,R2),/AI busy/);
    await assert.rejects(begin(A,R,Q,T,"Different payload"),/Request conflict/);
  });
  it("charges every agent attempt and never exceeds owner caps",async () => {
    await begin();
    for(let i=0;i<5;i++) assert.equal((await step()).allowed,true);
    assert.equal((await step()).code,"user_limit");
    assert.equal((await db.query<{n:number}>("select attempts n from public.ai_global_usage")).rows[0].n,5);
  });
  it("reserves the final quota slot for the answer before spending on a summary", async () => {
    await db.exec("update public.ai_quota_settings set user_limit=1");
    await begin();
    const denied = await as(A, () => db.query<{ v: { allowed: boolean } }>("select public.reserve_ai_agent_step($1,$2,50,50,1) v", [Q, R]));
    assert.equal(denied.rows[0].v.allowed, false);
    assert.equal((await step()).allowed, true);
  });
  it("bounds steps even when the daily owner cap is larger",async () => {
    await db.exec("update public.ai_quota_settings set user_limit=50,global_limit=50"); await begin();
    for(let i=0;i<8;i++) assert.equal((await step()).allowed,true);
    assert.equal((await step()).code,"step_limit");
  });
  it("allows a confirmed higher account tier without removing app or per-minute limits", async () => {
    await assert.rejects(db.exec("update public.ai_quota_settings set global_limit=1001"), /check constraint/);
    await db.exec(`update public.ai_quota_settings set global_limit=1000,user_limit=80;
      update public.ai_global_usage set attempts=999;`);
    await begin();
    const reserve = async () => as(A, async () => (await db.query<{ v: { allowed: boolean; code?: string; global_remaining: number } }>(
      "select public.reserve_ai_agent_step($1,$2,100,99999) v", [Q, R])).rows[0].v);
    assert.deepEqual(await reserve().then(({ allowed, global_remaining }) => ({ allowed, global_remaining })), { allowed: true, global_remaining: 0 });
    assert.equal((await reserve()).code, "global_limit");
    await db.exec("update public.ai_global_usage set attempts=990,recent_attempts=array_fill(clock_timestamp(), ARRAY[20]);");
    assert.equal((await reserve()).code, "rate_limit");
  });
  it("keeps the previous answer when regeneration fails",async () => {
    await begin(); await finish(); await begin(A,R2); await finish(A,R2,"failed","");
    const result=await db.query<{answer:string;status:string}>("select answer,status from public.ai_turns");
    assert.deepEqual(result.rows[0],{answer:"Ответ",status:"failed"});
  });
  it("rejects stale completions after an expired run is replaced",async () => {
    await begin(); await db.exec("update public.ai_turns set lease_expires_at=now()-interval '1 second'");
    await begin(A,R2); assert.equal(await finish(A,R),false); assert.equal(await finish(A,R2),true);
  });
  it("requires memory consent and deletes content on disabling",async () => {
    await assert.rejects(as(A,()=>db.query("insert into public.ai_preferences(user_id,enabled,content) values($1,true,'Python')",[A])),/check constraint/);
    await as(A,()=>db.query("insert into public.ai_preferences(user_id,enabled,content,consent_at) values($1,true,'Python',now())",[A]));
    assert.equal((await as(B,()=>db.query("select * from public.ai_preferences"))).rows.length,0);
    await assert.rejects(as(B,()=>db.query("insert into public.ai_preferences(user_id,enabled,content) values($1,false,'')",[A])),/row-level security/);
    await assert.rejects(as(A,()=>db.exec("update public.ai_preferences set enabled=false")),/check constraint/);
    await as(A,()=>db.exec("update public.ai_preferences set enabled=false,content='',consent_at=null"));
    assert.equal((await db.query<{content:string}>("select content from public.ai_preferences")).rows[0].content,"");
  });
});
