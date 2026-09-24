-- NEXUS v0.2: post images, private direct conversations, and public image storage.
begin;

alter table public.posts add column image_url text;
alter table public.posts add constraint posts_image_url_format check (
  image_url is null
  or (char_length(image_url) <= 2048 and image_url ~ '^https://[^[:space:]]+$')
);
grant insert (image_url), update (image_url) on public.posts to authenticated;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  -- Sorted canonical UUIDs identify one unordered pair, including during races.
  direct_key text not null unique,
  created_at timestamptz not null default now(),
  constraint conversations_direct_key_format check (
    direct_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(direct_key, ':', 1)::uuid < split_part(direct_key, ':', 2)::uuid
  )
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_body_length check (
    char_length(body) between 1 and 5000 and body ~ '[^[:space:]]'
  )
);

create index conversation_members_user_id_idx on public.conversation_members(user_id, conversation_id);
create index messages_conversation_created_at_idx on public.messages(conversation_id, created_at, id);
create index messages_sender_id_idx on public.messages(sender_id);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

revoke all on table public.conversations, public.conversation_members, public.messages
  from public, anon, authenticated;
grant select on table public.conversations, public.conversation_members, public.messages
  to authenticated;
grant insert (conversation_id, sender_id, body) on public.messages to authenticated;

-- The owner can inspect membership without recursively evaluating its own RLS.
-- No caller-supplied user ID: this helper only answers for the current session.
create function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = (select auth.uid())
  );
$$;

create policy conversations_read_members on public.conversations for select
to authenticated using (public.is_conversation_member(id));
create policy conversation_members_read_members on public.conversation_members for select
to authenticated using (public.is_conversation_member(conversation_id));
create policy messages_read_members on public.messages for select
to authenticated using (public.is_conversation_member(conversation_id));
create policy messages_insert_members on public.messages for insert
to authenticated with check (
  sender_id = (select auth.uid()) and public.is_conversation_member(conversation_id)
);

-- This is the only client entry point for creating conversations/memberships.
create function public.get_or_create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  pair_key text;
  result_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_other_user_id is null or p_other_user_id = current_user_id then
    raise exception 'Choose another user' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles where id in (current_user_id, p_other_user_id)) <> 2 then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  pair_key := least(current_user_id, p_other_user_id)::text || ':'
    || greatest(current_user_id, p_other_user_id)::text;
  -- A single UPSERT waits for competing creators and returns their existing ID.
  insert into public.conversations (direct_key) values (pair_key)
  on conflict (direct_key) do update set direct_key = excluded.direct_key
  returning id into result_id;

  insert into public.conversation_members (conversation_id, user_id)
  values (result_id, current_user_id), (result_id, p_other_user_id)
  on conflict (conversation_id, user_id) do nothing;
  return result_id;
end;
$$;

revoke all on function public.is_conversation_member(uuid) from public, anon, authenticated;
revoke all on function public.get_or_create_direct_conversation(uuid) from public, anon, authenticated;
grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

-- Public URLs are intentional; all writes stay inside the signed-in user's folder.
-- Storage API enforces MIME and byte limits from these bucket settings.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('post-media', 'post-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy nexus_images_read on storage.objects for select
to anon, authenticated using (bucket_id in ('avatars', 'post-media'));

create policy nexus_images_insert_own on storage.objects for insert
to authenticated with check (
  bucket_id in ('avatars', 'post-media')
  and name ~ ('^' || (select auth.uid())::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$')
);

create policy nexus_images_update_own on storage.objects for update
to authenticated using (
  bucket_id in ('avatars', 'post-media')
  and name ~ ('^' || (select auth.uid())::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$')
) with check (
  bucket_id in ('avatars', 'post-media')
  and name ~ ('^' || (select auth.uid())::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$')
);

create policy nexus_images_delete_own on storage.objects for delete
to authenticated using (
  bucket_id in ('avatars', 'post-media')
  and name ~ ('^' || (select auth.uid())::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$')
);

commit;
