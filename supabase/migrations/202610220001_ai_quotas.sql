-- Counts provider attempts, including the one optional fallback. No chat content is stored.
begin;

create table public.ai_quota_settings (
  singleton boolean primary key default true check (singleton),
  user_limit integer not null default 5 check (user_limit between 0 and 50),
  global_limit integer not null default 40 check (global_limit between 0 and 50)
);
insert into public.ai_quota_settings (singleton) values (true);

create table public.ai_global_usage (
  singleton boolean primary key default true check (singleton),
  usage_day date not null,
  attempts integer not null default 0 check (attempts between 0 and 50),
  recent_attempts timestamptz[] not null default '{}'
);
insert into public.ai_global_usage (singleton, usage_day)
  values (true, (clock_timestamp() at time zone 'UTC')::date);

create table public.ai_user_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  usage_day date not null,
  attempts integer not null default 0 check (attempts between 0 and 50),
  last_attempt_at timestamptz,
  request_id uuid,
  lease_expires_at timestamptz,
  fallback_used boolean not null default false,
  check ((request_id is null) = (lease_expires_at is null))
);

alter table public.ai_quota_settings enable row level security;
alter table public.ai_global_usage enable row level security;
alter table public.ai_user_usage enable row level security;
revoke all on public.ai_quota_settings, public.ai_global_usage, public.ai_user_usage
  from public, anon, authenticated;

create function public.reserve_ai_request(
  p_user_limit integer default 5,
  p_global_limit integer default 40,
  p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  request_time timestamptz;
  today date;
  user_cap integer;
  global_cap integer;
  global_row public.ai_global_usage%rowtype;
  user_row public.ai_user_usage%rowtype;
  recent timestamptz[];
  user_remaining integer;
  global_remaining integer;
  code text;
  retry_after integer := 0;
  reservation_id uuid;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Every reservation locks the same global row before its user row.
  select * into strict global_row from public.ai_global_usage where singleton for update;
  request_time := clock_timestamp();
  today := (request_time at time zone 'UTC')::date;
  select least(coalesce(p_user_limit, 5), user_limit),
         least(coalesce(p_global_limit, 40), global_limit)
    into strict user_cap, global_cap from public.ai_quota_settings where singleton;
  user_cap := greatest(0, user_cap);
  global_cap := greatest(0, global_cap);

  insert into public.ai_user_usage (user_id, usage_day) values (actor, today)
    on conflict (user_id) do nothing;
  select * into strict user_row from public.ai_user_usage where user_id = actor for update;
  if global_row.usage_day <> today then
    global_row.attempts := 0;
  end if;
  if user_row.usage_day <> today then
    user_row.attempts := 0;
  end if;
  select coalesce(array_agg(t order by t), '{}'::timestamptz[]) into recent
    from unnest(global_row.recent_attempts) t where t > request_time - interval '60 seconds';
  user_remaining := greatest(0, user_cap - user_row.attempts);
  global_remaining := greatest(0, global_cap - global_row.attempts);

  if p_request_id is not null and (
    user_row.request_id is distinct from p_request_id
    or user_row.lease_expires_at is null or user_row.lease_expires_at <= request_time
    or user_row.fallback_used
  ) then
    code := 'busy';
  elsif p_request_id is null and user_row.lease_expires_at > request_time then
    code := 'busy';
    retry_after := ceil(extract(epoch from user_row.lease_expires_at - request_time))::integer;
  elsif user_remaining = 0 then
    code := 'user_limit';
  elsif global_remaining = 0 then
    code := 'global_limit';
  elsif cardinality(recent) >= 20 then
    code := 'rate_limit';
    retry_after := greatest(1, ceil(extract(epoch from recent[1] + interval '60 seconds' - request_time))::integer);
  elsif p_request_id is null and user_row.last_attempt_at > request_time - interval '10 seconds' then
    code := 'rate_limit';
    retry_after := greatest(1, ceil(extract(epoch from user_row.last_attempt_at + interval '10 seconds' - request_time))::integer);
  end if;

  if code is not null then
    return jsonb_build_object('allowed', false, 'code', code,
      'user_remaining', user_remaining, 'global_remaining', global_remaining,
      'retry_after', retry_after);
  end if;

  reservation_id := coalesce(p_request_id, gen_random_uuid());
  update public.ai_global_usage set usage_day = today, attempts = global_row.attempts + 1,
    recent_attempts = array_append(recent, request_time) where singleton;
  update public.ai_user_usage set usage_day = today, attempts = user_row.attempts + 1,
    last_attempt_at = request_time, request_id = reservation_id,
    lease_expires_at = request_time + interval '90 seconds', fallback_used = p_request_id is not null
    where user_id = actor;
  return jsonb_build_object('allowed', true, 'request_id', reservation_id,
    'user_remaining', user_remaining - 1, 'global_remaining', global_remaining - 1);
end;
$$;

create function public.finish_ai_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  update public.ai_user_usage set request_id = null, lease_expires_at = null, fallback_used = false
    where user_id = actor and request_id = p_request_id;
end;
$$;

revoke all on function public.reserve_ai_request(integer, integer, uuid),
  public.finish_ai_request(uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_request(integer, integer, uuid),
  public.finish_ai_request(uuid) to authenticated;

commit;
