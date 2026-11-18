-- Additive AI history and bounded runs. Existing social tables and policies are unchanged.
begin;

create table public.ai_threads (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  summary text not null default '' check (char_length(summary) <= 6000),
  summary_through timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_threads_owner_updated on public.ai_threads(user_id, updated_at desc);

create table public.ai_turns (
  id uuid primary key,
  thread_id uuid not null references public.ai_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 4000),
  answer text not null default '' check (char_length(answer) <= 32000),
  mode text not null check (mode in ('auto','quick','research','solve')),
  status text not null default 'running' check (status in ('running','complete','failed','cancelled')),
  run_id uuid not null unique,
  lease_expires_at timestamptz not null,
  steps integer not null default 0 check (steps between 0 and 8),
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array' and octet_length(sources::text) <= 24000),
  actions jsonb not null default '[]' check (jsonb_typeof(actions) = 'array' and octet_length(actions::text) <= 16000),
  usage jsonb not null default '{}' check (jsonb_typeof(usage) = 'object' and octet_length(usage::text) <= 4000),
  error_code text check (char_length(error_code) <= 64),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index ai_turns_thread_created on public.ai_turns(thread_id, created_at);

create table public.ai_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  content text not null default '' check (char_length(content) <= 2000),
  consent_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((enabled and consent_at is not null) or (not enabled and content = '' and consent_at is null))
);

alter table public.ai_threads enable row level security;
alter table public.ai_turns enable row level security;
alter table public.ai_preferences enable row level security;
revoke all on public.ai_threads, public.ai_turns, public.ai_preferences from public, anon, authenticated;
grant select, delete on public.ai_threads to authenticated;
grant select on public.ai_turns to authenticated;
grant select, insert, update, delete on public.ai_preferences to authenticated;
create policy ai_threads_owner_read on public.ai_threads for select to authenticated using (user_id = (select auth.uid()));
create policy ai_threads_owner_delete on public.ai_threads for delete to authenticated using (user_id = (select auth.uid()));
create policy ai_turns_owner_read on public.ai_turns for select to authenticated using (user_id = (select auth.uid()));
create policy ai_preferences_owner on public.ai_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The client supplies only identifiers and its question. Ownership always comes from Auth.
create function public.begin_ai_turn(p_thread_id uuid, p_turn_id uuid, p_run_id uuid, p_question text, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); thread public.ai_threads%rowtype; turn public.ai_turns%rowtype;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_thread_id is null or p_turn_id is null or p_run_id is null or p_question is null
    or char_length(btrim(p_question)) not between 1 and 4000 or p_mode not in ('auto','quick','research','solve') or p_mode is null
    then raise exception 'Invalid request' using errcode = '22023'; end if;
  -- Per-user transaction lock also serializes creation and bounds abandoned history.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 4711));
  select * into thread from public.ai_threads where id = p_thread_id for update;
  if found and thread.user_id <> actor then raise exception 'Not found' using errcode = '42501'; end if;
  if not found then
    if (select count(*) from public.ai_threads where user_id = actor) >= 100 then
      raise exception 'History limit' using errcode = '54000'; end if;
    insert into public.ai_threads(id,user_id,title) values(p_thread_id,actor,left(btrim(p_question),100));
  end if;
  select * into turn from public.ai_turns where id = p_turn_id for update;
  if found then
    if turn.user_id <> actor or turn.thread_id <> p_thread_id or turn.question <> p_question then
      raise exception 'Request conflict' using errcode = '42501'; end if;
    if turn.run_id = p_run_id then return jsonb_build_object('replay',true,'turn',to_jsonb(turn)); end if;
    if exists(select 1 from public.ai_turns where thread_id = p_thread_id and created_at > turn.created_at) then
      raise exception 'Only latest turn may be regenerated' using errcode = '22023'; end if;
  end if;
  if exists(select 1 from public.ai_turns where user_id = actor and status = 'running' and lease_expires_at > clock_timestamp()) then
    raise exception 'AI busy' using errcode = '55P03'; end if;
  -- Expired work is visible as interrupted; it is never silently resumed.
  update public.ai_turns set status='failed',error_code='interrupted',updated_at=clock_timestamp()
    where user_id=actor and status='running' and lease_expires_at <= clock_timestamp();
  if turn.id is null then
    if (select count(*) from public.ai_turns where thread_id=p_thread_id) >= 250 then
      raise exception 'Thread limit' using errcode='54000'; end if;
    insert into public.ai_turns(id,thread_id,user_id,question,mode,run_id,lease_expires_at)
      values(p_turn_id,p_thread_id,actor,p_question,p_mode,p_run_id,clock_timestamp()+interval '80 seconds') returning * into turn;
  else
    update public.ai_turns set mode=p_mode,run_id=p_run_id,status='running',steps=0,error_code=null,
      lease_expires_at=clock_timestamp()+interval '80 seconds',updated_at=clock_timestamp()
      where id=p_turn_id returning * into turn;
  end if;
  update public.ai_threads set updated_at=clock_timestamp() where id=p_thread_id;
  return jsonb_build_object('replay',false,'turn',to_jsonb(turn));
end; $$;

-- Same global counters/caps as the original chat; each actual model attempt is charged.
create function public.reserve_ai_agent_step(p_turn_id uuid,p_run_id uuid,p_user_limit integer default 5,p_global_limit integer default 40,p_min_remaining integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); t timestamptz; today date; g public.ai_global_usage%rowtype;
  u public.ai_user_usage%rowtype; r public.ai_turns%rowtype; recent timestamptz[]; uc integer; gc integer; reason text;
  preserve integer := case when p_min_remaining = 1 then 1 else 0 end;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 4711));
  select * into strict g from public.ai_global_usage where singleton for update;
  t:=clock_timestamp(); today:=(t at time zone 'UTC')::date;
  select least(greatest(coalesce(p_user_limit,5),0),user_limit),least(greatest(coalesce(p_global_limit,40),0),global_limit)
    into strict uc,gc from public.ai_quota_settings where singleton;
  insert into public.ai_user_usage(user_id,usage_day) values(actor,today) on conflict(user_id) do nothing;
  select * into strict u from public.ai_user_usage where user_id=actor for update;
  select * into r from public.ai_turns where id=p_turn_id and user_id=actor and run_id=p_run_id for update;
  if not found or r.status <> 'running' or r.lease_expires_at <= t then
    raise exception 'Run unavailable' using errcode='42501'; end if;
  if g.usage_day <> today then g.attempts:=0; end if;
  if u.usage_day <> today then u.attempts:=0; end if;
  select coalesce(array_agg(x order by x),'{}'::timestamptz[]) into recent from unnest(g.recent_attempts) x where x>t-interval '60 seconds';
  if r.steps >= 8 then reason:='step_limit';
  elsif u.request_id is distinct from p_run_id and u.lease_expires_at > t then reason:='busy';
  elsif u.attempts + preserve >= uc then reason:='user_limit';
  elsif g.attempts + preserve >= gc then reason:='global_limit';
  elsif cardinality(recent) + preserve >= 20 then reason:='rate_limit';
  elsif r.steps=0 and u.last_attempt_at>t-interval '10 seconds' then reason:='rate_limit'; end if;
  if reason is not null then return jsonb_build_object('allowed',false,'code',reason,'retry_after',10,
    'user_remaining',greatest(0,uc-u.attempts),'global_remaining',greatest(0,gc-g.attempts)); end if;
  update public.ai_global_usage set usage_day=today,attempts=g.attempts+1,recent_attempts=array_append(recent,t) where singleton;
  update public.ai_user_usage set usage_day=today,attempts=u.attempts+1,last_attempt_at=t,request_id=p_run_id,
    lease_expires_at=r.lease_expires_at,fallback_used=true where user_id=actor;
  update public.ai_turns set steps=steps+1 where id=p_turn_id;
  return jsonb_build_object('allowed',true,'user_remaining',uc-u.attempts-1,'global_remaining',gc-g.attempts-1,'minute_remaining',19-cardinality(recent));
end; $$;

create function public.finish_ai_turn(p_turn_id uuid,p_run_id uuid,p_status text,p_answer text,p_sources jsonb,p_actions jsonb,p_usage jsonb,p_error_code text default null,
  p_summary text default null,p_summary_through timestamptz default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); r public.ai_turns%rowtype; parent_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 4711));
  if p_status not in ('complete','failed','cancelled') or p_status is null then raise exception 'Invalid status'; end if;
  -- Match global/user/turn lock order used by reservations to avoid deadlocks.
  perform 1 from public.ai_global_usage where singleton for update;
  perform 1 from public.ai_user_usage where user_id=actor for update;
  select thread_id into parent_id from public.ai_turns where id=p_turn_id and user_id=actor and run_id=p_run_id;
  if not found then return false; end if;
  perform 1 from public.ai_threads where id=parent_id and user_id=actor for update;
  if not found then return false; end if;
  select * into r from public.ai_turns where id=p_turn_id and user_id=actor and run_id=p_run_id for update;
  if not found or r.status <> 'running' then return false; end if;
  update public.ai_turns set status=p_status,
    answer=case when p_status='complete' then p_answer else answer end,
    sources=case when p_status='complete' then p_sources else sources end,
    actions=case when p_status='complete' then p_actions else actions end,
    usage=p_usage,error_code=p_error_code,updated_at=clock_timestamp() where id=p_turn_id;
  if p_status='complete' and p_summary is not null then
    update public.ai_threads set summary=p_summary,summary_through=p_summary_through where id=r.thread_id;
  end if;
  update public.ai_user_usage set request_id=null,lease_expires_at=null,fallback_used=false where user_id=actor and request_id=p_run_id;
  return true;
end; $$;

revoke all on function public.begin_ai_turn(uuid,uuid,uuid,text,text),public.reserve_ai_agent_step(uuid,uuid,integer,integer,integer),
  public.finish_ai_turn(uuid,uuid,text,text,jsonb,jsonb,jsonb,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.begin_ai_turn(uuid,uuid,uuid,text,text),public.reserve_ai_agent_step(uuid,uuid,integer,integer,integer),
  public.finish_ai_turn(uuid,uuid,text,text,jsonb,jsonb,jsonb,text,text,timestamptz) to authenticated;
commit;
