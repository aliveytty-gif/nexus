-- NEXUS Core MVP. Apply once through Supabase migrations or the SQL Editor.
-- auth.users and auth.uid() are provided by Supabase Auth.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '' check (char_length(first_name) <= 80),
  last_name text not null default '' check (char_length(last_name) <= 80),
  username text not null unique,
  avatar_url text,
  bio text not null default '' check (char_length(bio) <= 300),
  specialty text not null default '' check (char_length(specialty) <= 120),
  course smallint check (course between 1 and 6),
  group_name text not null default '' check (char_length(group_name) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,40}$' and username <> 'edit'),
  -- Reserve automatically assigned names so a user cannot block a later signup.
  constraint profiles_username_reserved check (
    username !~ '^u_[0-9a-f]{32}$'
    or username = 'u_' || replace(id::text, '-', '')
  ),
  constraint profiles_avatar_url_format check (
    avatar_url is null
    or (char_length(avatar_url) <= 2048 and avatar_url ~ '^https://[^[:space:]]+$')
  )
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_content_length check (
    char_length(content) between 1 and 5000 and content ~ '[^[:space:]]'
  )
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comments_content_length check (
    char_length(content) between 1 and 2000 and content ~ '[^[:space:]]'
  )
);

create table public.interests (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  name text not null unique check (char_length(name) between 1 and 60)
);

create table public.profile_interests (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  interest_id uuid not null references public.interests(id) on delete cascade,
  primary key (profile_id, interest_id)
);

-- Stable ordering and indexed foreign-key lookups for the chronological feed.
create index posts_created_at_id_idx on public.posts(created_at desc, id desc);
create index posts_author_id_created_at_idx on public.posts(author_id, created_at desc);
create index comments_post_id_created_at_idx on public.comments(post_id, created_at, id);
create index comments_author_id_idx on public.comments(author_id);
create index profile_interests_interest_id_idx on public.profile_interests(interest_id, profile_id);

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger posts_set_updated_at before update on public.posts
for each row execute function public.set_updated_at();
create trigger comments_set_updated_at before update on public.comments
for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name, username)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), 80),
    left(btrim(coalesce(new.raw_user_meta_data ->> 'last_name', '')), 80),
    'u_' || replace(new.id::text, '-', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.interests enable row level security;
alter table public.profile_interests enable row level security;

-- Start from explicit grants: hosted Supabase may have broad default grants.
revoke all on table public.profiles, public.posts, public.comments,
  public.interests, public.profile_interests from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on table public.profiles, public.posts, public.comments,
  public.interests, public.profile_interests to authenticated;
grant update (first_name, last_name, username, avatar_url, bio, specialty, course, group_name)
  on public.profiles to authenticated;
grant insert (author_id, content), update (content), delete on public.posts to authenticated;
grant insert (post_id, author_id, content), update (content), delete on public.comments to authenticated;
grant insert (profile_id, interest_id), delete on public.profile_interests to authenticated;

create policy profiles_read_authenticated on public.profiles for select
to authenticated using ((select auth.uid()) is not null);
create policy profiles_update_own on public.profiles for update
to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy posts_read_authenticated on public.posts for select
to authenticated using ((select auth.uid()) is not null);
create policy posts_insert_own on public.posts for insert
to authenticated with check ((select auth.uid()) = author_id);
create policy posts_update_own on public.posts for update
to authenticated using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy posts_delete_own on public.posts for delete
to authenticated using ((select auth.uid()) = author_id);

create policy comments_read_authenticated on public.comments for select
to authenticated using ((select auth.uid()) is not null);
create policy comments_insert_own on public.comments for insert
to authenticated with check ((select auth.uid()) = author_id);
create policy comments_update_own on public.comments for update
to authenticated using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy comments_delete_own on public.comments for delete
to authenticated using ((select auth.uid()) = author_id);

create policy interests_read_authenticated on public.interests for select
to authenticated using ((select auth.uid()) is not null);
create policy profile_interests_read_authenticated on public.profile_interests for select
to authenticated using ((select auth.uid()) is not null);
create policy profile_interests_insert_own on public.profile_interests for insert
to authenticated with check ((select auth.uid()) = profile_id);
create policy profile_interests_delete_own on public.profile_interests for delete
to authenticated using ((select auth.uid()) = profile_id);

-- One PostgREST RPC is one transaction: a failed field/interest validation rolls
-- back every write. SECURITY INVOKER keeps all ordinary ownership RLS in effect.
create function public.update_my_profile(
  p_first_name text,
  p_last_name text,
  p_username text,
  p_avatar_url text,
  p_bio text,
  p_specialty text,
  p_course integer,
  p_group_name text,
  p_interest_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  selected_interests uuid[] := coalesce(p_interest_ids, array[]::uuid[]);
begin
  if current_profile_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if cardinality(selected_interests) > 10 then
    raise exception 'Choose at most 10 interests' using errcode = '22023';
  end if;
  if cardinality(selected_interests) <> (
    select count(distinct requested.id) from unnest(selected_interests) as requested(id)
  ) then
    raise exception 'Interest IDs must be unique and non-null' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(selected_interests) as requested(id)
    where not exists (select 1 from public.interests where id = requested.id)
  ) then
    raise exception 'Unknown interest' using errcode = '22023';
  end if;

  update public.profiles set
    first_name = btrim(p_first_name),
    last_name = btrim(p_last_name),
    username = lower(btrim(p_username)),
    avatar_url = nullif(btrim(p_avatar_url), ''),
    bio = btrim(p_bio),
    specialty = btrim(p_specialty),
    course = p_course,
    group_name = btrim(p_group_name)
  where id = current_profile_id;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  delete from public.profile_interests where profile_id = current_profile_id;
  insert into public.profile_interests (profile_id, interest_id)
  select current_profile_id, requested.id from unnest(selected_interests) as requested(id);
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.update_my_profile(text, text, text, text, text, text, integer, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.update_my_profile(text, text, text, text, text, text, integer, text, uuid[])
  to authenticated;

-- Fixed UUIDs make local, test, and hosted copies of the catalog identical.
insert into public.interests (id, slug, name) values
  ('10000000-0000-4000-8000-000000000001', 'music', 'музыка'),
  ('10000000-0000-4000-8000-000000000002', 'programming', 'программирование'),
  ('10000000-0000-4000-8000-000000000003', 'sports', 'спорт'),
  ('10000000-0000-4000-8000-000000000004', 'gaming', 'игры'),
  ('10000000-0000-4000-8000-000000000005', 'design', 'дизайн'),
  ('10000000-0000-4000-8000-000000000006', 'photography', 'фото'),
  ('10000000-0000-4000-8000-000000000007', 'cinema', 'кино');

commit;
