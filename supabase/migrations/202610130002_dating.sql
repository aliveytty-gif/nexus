-- Explicit opt-in dating; private photos never share public avatar/post permissions.
begin;

create table public.dating_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  bio text not null default '' check (char_length(bio) <= 500),
  age integer check (age between 18 and 100),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.dating_reactions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('liked', 'skipped')),
  created_at timestamptz not null default now(),
  primary key (user_id, target_user_id),
  check (user_id <> target_user_id)
);
create table public.dating_matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b), check (user_a < user_b)
);
create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id), check (blocker_id <> blocked_id)
);
create index user_blocks_reverse_idx on public.user_blocks(blocked_id, blocker_id);
create index dating_matches_user_b_idx on public.dating_matches(user_b);
create table public.dating_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique (reporter_id, reported_id), check (reporter_id <> reported_id)
);

alter table public.dating_profiles enable row level security;
alter table public.dating_reactions enable row level security;
alter table public.dating_matches enable row level security;
alter table public.user_blocks enable row level security;
alter table public.dating_reports enable row level security;
revoke all on public.dating_profiles, public.dating_reactions, public.dating_matches,
  public.user_blocks, public.dating_reports from public, anon, authenticated;
grant select on public.dating_profiles, public.dating_reactions, public.dating_matches,
  public.user_blocks, public.dating_reports to authenticated;

-- Session-bound helpers: callers cannot probe relationships between arbitrary people.
create function public.is_user_blocked(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.user_blocks
    where (blocker_id = auth.uid() and blocked_id = p_user_id)
       or (blocked_id = auth.uid() and blocker_id = p_user_id));
$$;
create function public.get_blocked_user_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct case when blocker_id = auth.uid() then blocked_id else blocker_id end), '{}'::uuid[])
    from public.user_blocks where blocker_id = auth.uid() or blocked_id = auth.uid();
$$;
create function public.can_view_dating_profile(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    p_user_id = auth.uid() or (
      exists (select 1 from public.dating_profiles where user_id = auth.uid() and enabled)
      and exists (select 1 from public.dating_profiles where user_id = p_user_id and enabled)
      and not public.is_user_blocked(p_user_id)
    ));
$$;
create policy dating_profiles_read on public.dating_profiles for select to authenticated
  using (public.can_view_dating_profile(user_id));
create policy dating_reactions_read on public.dating_reactions for select to authenticated using (user_id = auth.uid());
create policy dating_matches_read on public.dating_matches for select to authenticated using (
  (user_a = auth.uid() or user_b = auth.uid())
  and public.can_view_dating_profile(case when user_a = auth.uid() then user_b else user_a end)
);
create policy user_blocks_read on public.user_blocks for select to authenticated using (blocker_id = auth.uid());
create policy dating_reports_read on public.dating_reports for select to authenticated using (reporter_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dating-photos', 'dating-photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create function public.is_own_dating_photo(p_path text) returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null and coalesce(p_path ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_][A-Za-z0-9._-]{0,179}\.(jpg|jpeg|png|webp)$'
    and split_part(p_path, '/', 1) = auth.uid()::text, false);
$$;
create policy dating_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dating-photos' and public.is_own_dating_photo(name));
create policy dating_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dating-photos' and public.is_own_dating_photo(name));
create policy dating_photos_read on storage.objects for select to authenticated using (
  bucket_id = 'dating-photos' and (public.is_own_dating_photo(name)
    or exists (select 1 from public.dating_profiles d where name = any(d.photo_paths)))
);

create function public.save_dating_profile(p_enabled boolean, p_bio text, p_age integer, p_photo_paths text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  photo_path text;
  object_metadata jsonb;
  extension text;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_enabled is null or p_bio is null or char_length(btrim(p_bio)) > 500
    or (p_age is not null and p_age not between 18 and 100)
    or p_photo_paths is null or cardinality(p_photo_paths) > 6
    or cardinality(p_photo_paths) <> (select count(distinct x) from unnest(p_photo_paths) x) then
    raise exception 'Invalid dating profile' using errcode = '22023';
  end if;
  foreach photo_path in array p_photo_paths loop
    if not public.is_own_dating_photo(photo_path) then
      raise exception 'Photo must belong to you' using errcode = '42501';
    end if;
    select metadata into object_metadata from storage.objects where bucket_id = 'dating-photos' and name = photo_path;
    extension := substring(photo_path from '\.([a-z]+)$');
    if object_metadata is null or coalesce(object_metadata->>'size', '') !~ '^[0-9]+$'
      or coalesce(object_metadata->>'mimetype', '') <> (case extension
        when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg'
        when 'png' then 'image/png' when 'webp' then 'image/webp' else '' end) then
      raise exception 'Invalid photo metadata' using errcode = '23514';
    end if;
    if (object_metadata->>'size')::numeric not between 1 and 10485760 then
      raise exception 'Photo exceeds 10 MB' using errcode = '23514';
    end if;
  end loop;
  insert into public.dating_profiles(user_id, enabled, bio, age, photo_paths)
    values (actor, p_enabled, btrim(p_bio), p_age, p_photo_paths)
  on conflict (user_id) do update set enabled = excluded.enabled, bio = excluded.bio,
    age = excluded.age, photo_paths = excluded.photo_paths, updated_at = now();
end;
$$;

create function public.set_user_block(p_user_id uuid, p_blocked boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_user_id is null or p_user_id = actor or p_blocked is null then
    raise exception 'Choose another user' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(least(actor,p_user_id)::text || ':' || greatest(actor,p_user_id)::text, 0));
  if p_blocked then
    insert into public.user_blocks(blocker_id, blocked_id) values (actor, p_user_id) on conflict do nothing;
  else
    delete from public.user_blocks where blocker_id = actor and blocked_id = p_user_id;
  end if;
end;
$$;

create function public.react_to_dating_profile(p_target_user_id uuid, p_reaction text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_target_user_id is null or p_target_user_id = actor or p_reaction is null
    or p_reaction not in ('liked','skipped') then
    raise exception 'Invalid dating reaction' using errcode = '22023';
  end if;
  -- Both directions, blocks and direct-chat starts share one transaction lock.
  perform pg_advisory_xact_lock(hashtextextended(least(actor,p_target_user_id)::text || ':' || greatest(actor,p_target_user_id)::text, 0));
  -- Opt-out cannot pass an in-flight reaction. Sorted row locks prevent cross-pair deadlocks.
  perform 1 from public.dating_profiles where user_id in (actor,p_target_user_id) order by user_id for share;
  if not public.can_view_dating_profile(p_target_user_id) then
    raise exception 'Dating profile unavailable' using errcode = '42501';
  end if;
  insert into public.dating_reactions(user_id,target_user_id,reaction) values (actor,p_target_user_id,p_reaction)
    on conflict do nothing;
  if exists (select 1 from public.dating_reactions where user_id = actor and target_user_id = p_target_user_id and reaction = 'liked')
    and exists (select 1 from public.dating_reactions where user_id = p_target_user_id and target_user_id = actor and reaction = 'liked') then
    insert into public.dating_matches(user_a,user_b) values (least(actor,p_target_user_id),greatest(actor,p_target_user_id))
      on conflict (user_a,user_b) do nothing;
    select id into result_id from public.dating_matches where user_a = least(actor,p_target_user_id) and user_b = greatest(actor,p_target_user_id);
  end if;
  return result_id;
end;
$$;

create function public.report_dating_profile(p_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_user_id is null or p_user_id = actor or p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'Invalid report' using errcode = '22023';
  end if;
  -- Reporting remains possible after blocking. Reports are retained privately for owner review.
  if not exists (select 1 from public.dating_profiles where user_id = actor and enabled)
    or not exists (select 1 from public.dating_profiles where user_id = p_user_id and enabled) then
    raise exception 'Dating profile unavailable' using errcode = 'P0002';
  end if;
  insert into public.dating_reports(reporter_id,reported_id,reason) values(actor,p_user_id,btrim(p_reason))
    on conflict (reporter_id,reported_id) do nothing;
  insert into public.dating_reactions(user_id,target_user_id,reaction) values(actor,p_user_id,'skipped') on conflict do nothing;
end;
$$;

create function public.get_dating_candidates(
  p_min_age integer default null, p_max_age integer default null, p_course integer default null,
  p_specialty text default null, p_interest_id uuid default null, p_limit integer default 30
) returns table (
  user_id uuid, first_name text, last_name text, username text, specialty text, course integer,
  bio text, age integer, photo_paths text[], interests jsonb, score integer
) language sql stable security invoker set search_path = '' as $$
  select d.user_id, p.first_name, p.last_name, p.username, p.specialty, p.course::integer,
    d.bio,d.age,d.photo_paths,
    coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name) order by i.name)
      from public.profile_interests pi join public.interests i on i.id = pi.interest_id where pi.profile_id = d.user_id),'[]'::jsonb),
    ((select count(*) from public.profile_interests pi join public.profile_interests mine on mine.interest_id = pi.interest_id
      where pi.profile_id = d.user_id and mine.profile_id = auth.uid()) * 3
      + case when p.specialty <> '' and p.specialty = me.specialty then 2 else 0 end
      + case when p.course = me.course then 1 else 0 end)::integer as score
  from public.dating_profiles d join public.profiles p on p.id = d.user_id
    join public.profiles me on me.id = auth.uid()
  where d.enabled and d.user_id <> auth.uid()
    and not exists (select 1 from public.dating_reactions r where r.user_id = auth.uid() and r.target_user_id = d.user_id)
    and (p_min_age is null or d.age >= p_min_age) and (p_max_age is null or d.age <= p_max_age)
    and (p_course is null or p.course = p_course)
    and (p_specialty is null or p_specialty = '' or p.specialty ilike '%' || p_specialty || '%')
    and (p_interest_id is null or exists (select 1 from public.profile_interests pi where pi.profile_id = d.user_id and pi.interest_id = p_interest_id))
  order by score desc, d.user_id limit greatest(1,least(coalesce(p_limit,30),50));
$$;

-- Preserve existing membership and direct_key idempotency; block every entry point to starting a direct chat.
create or replace function public.get_or_create_direct_conversation(p_other_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  pair_key text;
  result_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_other_user_id is null or p_other_user_id = current_user_id then
    raise exception 'Choose another user' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles where id in (current_user_id,p_other_user_id)) <> 2 then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  pair_key := least(current_user_id,p_other_user_id)::text || ':' || greatest(current_user_id,p_other_user_id)::text;
  perform pg_advisory_xact_lock(hashtextextended(pair_key,0));
  if public.is_user_blocked(p_other_user_id) then raise exception 'User unavailable' using errcode = '42501'; end if;
  insert into public.conversations(direct_key) values(pair_key)
    on conflict (direct_key) do update set direct_key = excluded.direct_key returning id into result_id;
  insert into public.conversation_members(conversation_id,user_id)
    values(result_id,current_user_id),(result_id,p_other_user_id) on conflict do nothing;
  return result_id;
end;
$$;

revoke all on function public.is_user_blocked(uuid), public.get_blocked_user_ids(), public.can_view_dating_profile(uuid), public.is_own_dating_photo(text),
  public.save_dating_profile(boolean,text,integer,text[]), public.set_user_block(uuid,boolean),
  public.react_to_dating_profile(uuid,text), public.report_dating_profile(uuid,text),
  public.get_dating_candidates(integer,integer,integer,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.is_user_blocked(uuid), public.get_blocked_user_ids(), public.can_view_dating_profile(uuid), public.is_own_dating_photo(text),
  public.save_dating_profile(boolean,text,integer,text[]), public.set_user_block(uuid,boolean),
  public.react_to_dating_profile(uuid,text), public.report_dating_profile(uuid,text),
  public.get_dating_candidates(integer,integer,integer,text,uuid,integer) to authenticated;
commit;
