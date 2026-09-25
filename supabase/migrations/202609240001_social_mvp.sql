-- Additive social MVP: private message files, likes, and public communities.
begin;

alter table public.messages
  add column attachment_path text,
  add column attachment_name text,
  add column attachment_type text,
  add column attachment_size bigint;
alter table public.messages drop constraint messages_body_length;
alter table public.messages add constraint messages_body_length check (
  char_length(body) <= 5000 and (body ~ '[^[:space:]]' or attachment_path is not null)
);
alter table public.messages add constraint messages_attachment_fields check (
  num_nonnulls(attachment_path, attachment_name, attachment_type, attachment_size) in (0, 4)
  and (attachment_path is null or (
    char_length(attachment_path) <= 400
    and char_length(attachment_name) between 1 and 255
    and attachment_name !~ '[/\\[:cntrl:]]'
    and attachment_name ~ '[^[:space:]]'
    and attachment_type in (
      'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip', 'application/x-zip-compressed'
    )
    and attachment_size between 1 and 10485760
  ))
);
grant insert (attachment_path, attachment_name, attachment_type, attachment_size)
  on public.messages to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-files', 'message-files', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip', 'application/x-zip-compressed'
])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Validate before casting: malformed paths cannot escape policies with UUID errors.
create function public.can_access_message_file(p_path text, p_own boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_path is null or p_path !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_][A-Za-z0-9._-]{0,179}\.(jpg|jpeg|png|webp|pdf|txt|doc|docx|zip)$'
  then return false; end if;
  return (not p_own or split_part(p_path, '/', 2) = auth.uid()::text)
    and public.is_conversation_member(split_part(p_path, '/', 1)::uuid);
end;
$$;
revoke all on function public.can_access_message_file(text, boolean) from public, anon, authenticated;
grant execute on function public.can_access_message_file(text, boolean) to authenticated;

create policy nexus_message_files_read on storage.objects for select to authenticated
  using (bucket_id = 'message-files' and public.can_access_message_file(name, false));
create policy nexus_message_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'message-files' and public.can_access_message_file(name, true));
create policy nexus_message_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'message-files' and public.can_access_message_file(name, true));
-- No UPDATE policy: files cannot be overwritten or moved to another conversation.

create function public.validate_message_attachment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  object_metadata jsonb;
begin
  if num_nonnulls(new.attachment_path, new.attachment_name, new.attachment_type, new.attachment_size) = 0 then
    return new;
  end if;
  if num_nonnulls(new.attachment_path, new.attachment_name, new.attachment_type, new.attachment_size) <> 4 then
    raise exception 'Incomplete attachment' using errcode = '23514';
  end if;
  if new.sender_id <> auth.uid() or not public.can_access_message_file(new.attachment_path, true)
    or split_part(new.attachment_path, '/', 1) <> new.conversation_id::text then
    raise exception 'Attachment does not belong to this sender and conversation' using errcode = '42501';
  end if;
  -- Storage owns these metadata values. Never trust the form's MIME or size alone.
  select metadata into object_metadata from storage.objects
    where bucket_id = 'message-files' and name = new.attachment_path;
  if not found or object_metadata->>'mimetype' is distinct from new.attachment_type
    or coalesce(object_metadata->>'size', '') !~ '^[0-9]{1,8}$' then
    raise exception 'Attachment is missing or its metadata is invalid' using errcode = '23514';
  end if;
  if (object_metadata->>'size')::bigint <> new.attachment_size then
    raise exception 'Attachment size does not match Storage' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_message_attachment() from public, anon, authenticated;
create trigger messages_validate_attachment before insert or update on public.messages
  for each row execute function public.validate_message_attachment();

create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_id_idx on public.post_likes(user_id);
alter table public.post_likes enable row level security;
revoke all on public.post_likes from public, anon, authenticated;
grant select, delete on public.post_likes to authenticated;
grant insert (post_id, user_id) on public.post_likes to authenticated;
create policy post_likes_read_authenticated on public.post_likes for select to authenticated
  using ((select auth.uid()) is not null);
create policy post_likes_insert_own on public.post_likes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy post_likes_delete_own on public.post_likes for delete to authenticated
  using (user_id = (select auth.uid()));

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  avatar_url text check (avatar_url is null or (
    char_length(avatar_url) <= 2048 and avatar_url ~ '^https://[^[:space:]]+$'
  )),
  type text not null check (type in ('group', 'channel')),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index communities_owner_id_idx on public.communities(owner_id);
create index community_members_user_id_idx on public.community_members(user_id, community_id);
create unique index community_members_one_owner_idx on public.community_members(community_id) where role = 'owner';
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
revoke all on public.communities, public.community_members from public, anon, authenticated;
grant select on public.communities, public.community_members to authenticated;
grant update (name, description, avatar_url) on public.communities to authenticated;
grant insert (community_id, user_id), delete on public.community_members to authenticated;

create policy communities_read_authenticated on public.communities for select to authenticated
  using ((select auth.uid()) is not null);
create policy communities_update_owner on public.communities for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy community_members_read_authenticated on public.community_members for select to authenticated
  using ((select auth.uid()) is not null);
create policy community_members_join_self on public.community_members for insert to authenticated
  with check (user_id = (select auth.uid()) and role = 'member');
create policy community_members_leave_self on public.community_members for delete to authenticated
  using (user_id = (select auth.uid()) and role <> 'owner');

create function public.create_community(p_name text, p_description text, p_type text, p_avatar_url text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  result_id uuid;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  insert into public.communities (name, description, type, avatar_url, owner_id)
    values (btrim(p_name), btrim(p_description), p_type, p_avatar_url, current_user_id)
    returning id into result_id;
  insert into public.community_members (community_id, user_id, role)
    values (result_id, current_user_id, 'owner');
  return result_id;
end;
$$;

create function public.can_publish_to_community(p_community_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.community_members m
    join public.communities c on c.id = m.community_id
    where m.community_id = p_community_id and m.user_id = (select auth.uid())
      and (c.type = 'group' or m.role in ('owner', 'admin'))
  );
$$;
revoke all on function public.create_community(text, text, text, text) from public, anon, authenticated;
revoke all on function public.can_publish_to_community(uuid) from public, anon, authenticated;
grant execute on function public.create_community(text, text, text, text) to authenticated;
grant execute on function public.can_publish_to_community(uuid) to authenticated;

alter table public.posts add column community_id uuid references public.communities(id) on delete cascade;
create index posts_community_created_at_idx on public.posts(community_id, created_at desc, id desc)
  where community_id is not null;
grant insert (community_id) on public.posts to authenticated;
drop policy posts_insert_own on public.posts;
create policy posts_insert_own on public.posts for insert to authenticated with check (
  author_id = (select auth.uid())
  and (community_id is null or public.can_publish_to_community(community_id))
);
drop policy posts_update_own on public.posts;
create policy posts_update_own on public.posts for update to authenticated
  using (author_id = (select auth.uid()) and (community_id is null or public.can_publish_to_community(community_id)))
  with check (author_id = (select auth.uid()) and (community_id is null or public.can_publish_to_community(community_id)));

commit;
