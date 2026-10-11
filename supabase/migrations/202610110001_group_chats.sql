-- Group conversations reuse the existing membership RLS and private message-files.
begin;

alter table public.conversations
  add column kind text not null default 'direct' check (kind in ('direct', 'group')),
  add column title text,
  add column avatar_path text,
  alter column direct_key drop not null;
alter table public.conversations add constraint conversations_kind_fields check (
  (kind = 'direct' and direct_key is not null and title is null and avatar_path is null)
  or (kind = 'group' and direct_key is null and title is not null
    and char_length(title) between 1 and 100 and title ~ '[^[:space:]]')
);
alter table public.conversation_members
  add column role text not null default 'member' check (role in ('creator', 'admin', 'member')),
  add column joined_at timestamptz not null default now(),
  add column last_read_at timestamptz not null default now();
create unique index conversation_members_one_creator_idx
  on public.conversation_members (conversation_id) where role = 'creator';

-- Table writes remain revoked: membership and roles change only through these RPCs.
create function public.create_group_conversation(p_title text, p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result_id uuid;
  members uuid[];
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 100
    or p_title !~ '[^[:space:]]' or array_position(p_member_ids, null) is not null then
    raise exception 'Invalid group details' using errcode = '22023';
  end if;
  select array_agg(distinct member_id) into members
    from unnest(p_member_ids) member_id where member_id <> actor;
  if coalesce(cardinality(members), 0) = 0 then
    raise exception 'Choose at least one other member' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = actor)
    or (select count(*) from public.profiles where id = any(members)) <> cardinality(members) then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  insert into public.conversations (kind, title) values ('group', btrim(p_title)) returning id into result_id;
  insert into public.conversation_members (conversation_id, user_id, role) values (result_id, actor, 'creator');
  insert into public.conversation_members (conversation_id, user_id)
    select result_id, member_id from unnest(members) member_id;
  return result_id;
end;
$$;

create function public.update_group_conversation(p_conversation_id uuid, p_title text, p_avatar_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_avatar text;
  object_metadata jsonb;
  extension text;
begin
  select avatar_path into current_avatar from public.conversations
    where id = p_conversation_id and kind = 'group' for update;
  if not found or not exists (select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = auth.uid() and role = 'creator') then
    raise exception 'Only the creator can edit this group' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 100 or p_title !~ '[^[:space:]]' then
    raise exception 'Invalid group title' using errcode = '22023';
  end if;
  -- A successor may keep the existing avatar; any replacement must be their upload.
  if p_avatar_path is not null and p_avatar_path is distinct from current_avatar then
    if not public.can_access_message_file(p_avatar_path, true)
      or split_part(p_avatar_path, '/', 1) <> p_conversation_id::text
      or p_avatar_path !~ '\.(jpg|jpeg|png|webp)$' then
      raise exception 'Invalid avatar path' using errcode = '42501';
    end if;
    select metadata into object_metadata from storage.objects
      where bucket_id = 'message-files' and name = p_avatar_path;
    extension := substring(p_avatar_path from '\.([a-z]+)$');
    if object_metadata is null or coalesce(object_metadata->>'size', '') !~ '^[0-9]+$'
      or coalesce(object_metadata->>'mimetype', '') <> (case extension
        when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg'
        when 'png' then 'image/png' when 'webp' then 'image/webp' else '' end) then
      raise exception 'Invalid avatar metadata' using errcode = '23514';
    end if;
    if (object_metadata->>'size')::numeric not between 1 and 5242880 then
      raise exception 'Avatar exceeds 5 MB' using errcode = '23514';
    end if;
  end if;
  update public.conversations set title = btrim(p_title), avatar_path = p_avatar_path where id = p_conversation_id;
end;
$$;

create function public.manage_group_member(p_conversation_id uuid, p_user_id uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_role text;
  target_role text;
begin
  perform 1 from public.conversations where id = p_conversation_id and kind = 'group' for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  select role into actor_role from public.conversation_members
    where conversation_id = p_conversation_id and user_id = auth.uid();
  if actor_role is null or actor_role not in ('creator', 'admin') then
    raise exception 'Group management unavailable' using errcode = '42501';
  end if;
  if p_user_id is null or p_action is null or p_action not in ('add', 'remove', 'promote', 'demote') then
    raise exception 'Invalid member action' using errcode = '22023';
  end if;
  select role into target_role from public.conversation_members
    where conversation_id = p_conversation_id and user_id = p_user_id;
  if p_action = 'add' then
    if not exists (select 1 from public.profiles where id = p_user_id) then
      raise exception 'Profile not found' using errcode = 'P0002';
    end if;
    insert into public.conversation_members (conversation_id, user_id) values (p_conversation_id, p_user_id)
      on conflict (conversation_id, user_id) do nothing;
    return;
  end if;
  if target_role is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if target_role = 'creator' or (actor_role = 'admin' and (p_action <> 'remove' or target_role <> 'member')) then
    raise exception 'Cannot change this member' using errcode = '42501';
  end if;
  if p_action = 'remove' then
    delete from public.conversation_members where conversation_id = p_conversation_id and user_id = p_user_id;
  else
    update public.conversation_members set role = case p_action when 'promote' then 'admin' else 'member' end
      where conversation_id = p_conversation_id and user_id = p_user_id;
  end if;
end;
$$;

create function public.leave_group_conversation(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_role text;
  successor uuid;
begin
  perform 1 from public.conversations where id = p_conversation_id and kind = 'group' for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  select role into actor_role from public.conversation_members
    where conversation_id = p_conversation_id and user_id = auth.uid();
  if actor_role is null then raise exception 'Membership required' using errcode = '42501'; end if;
  if actor_role = 'creator' then
    select user_id into successor from public.conversation_members
      where conversation_id = p_conversation_id and user_id <> auth.uid()
      order by (role = 'admin') desc, joined_at, user_id limit 1;
  end if;
  delete from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid();
  if successor is not null then
    update public.conversation_members set role = 'creator' where conversation_id = p_conversation_id and user_id = successor;
  end if;
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id) then
    delete from public.conversations where id = p_conversation_id;
  end if;
end;
$$;

create function public.mark_conversation_read(p_conversation_id uuid, p_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  seen_at timestamptz;
begin
  perform 1 from public.conversations where id = p_conversation_id for update;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Membership required' using errcode = '42501';
  end if;
  select created_at into seen_at from public.messages where id = p_message_id and conversation_id = p_conversation_id;
  if seen_at is null then raise exception 'Message not found' using errcode = 'P0002'; end if;
  update public.conversation_members set last_read_at = greatest(last_read_at, seen_at)
    where conversation_id = p_conversation_id and user_id = auth.uid();
end;
$$;

-- One bounded preview per conversation. RLS and the explicit own-membership join
-- both scope this invoker function; it never loads the group's full roster.
create function public.get_conversation_summaries()
returns table (
  id uuid, kind text, title text, avatar_path text, created_at timestamptz,
  role text, last_read_at timestamptz,
  other_id uuid, other_username text, other_first_name text, other_last_name text, other_avatar_url text,
  last_message_id uuid, last_body text, last_attachment_name text,
  last_message_at timestamptz, last_sender_id uuid, unread boolean
)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.kind, c.title, c.avatar_path, c.created_at, own.role, own.last_read_at,
    other.id, other.username, other.first_name, other.last_name, other.avatar_url,
    recent.id, recent.body, coalesce(recent.attachments->0->>'name', recent.attachment_name),
    recent.created_at, recent.sender_id,
    exists (select 1 from public.messages unread_message
      where unread_message.conversation_id = c.id and unread_message.sender_id <> auth.uid()
        and unread_message.created_at > own.last_read_at)
  from public.conversation_members own
  join public.conversations c on c.id = own.conversation_id
  left join lateral (
    select p.id, p.username, p.first_name, p.last_name, p.avatar_url
    from public.conversation_members counterpart join public.profiles p on p.id = counterpart.user_id
    where counterpart.conversation_id = c.id and counterpart.user_id <> auth.uid() and c.kind = 'direct'
    limit 1
  ) other on true
  left join lateral (
    select m.id, m.body, m.attachments, m.attachment_name, m.created_at, m.sender_id
    from public.messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1
  ) recent on true
  where own.user_id = auth.uid()
  order by coalesce(recent.created_at, c.created_at) desc, c.id;
$$;

revoke all on function public.create_group_conversation(text, uuid[]),
  public.update_group_conversation(uuid, text, text), public.manage_group_member(uuid, uuid, text),
  public.leave_group_conversation(uuid), public.mark_conversation_read(uuid, uuid),
  public.get_conversation_summaries() from public, anon, authenticated;
grant execute on function public.create_group_conversation(text, uuid[]),
  public.update_group_conversation(uuid, text, text), public.manage_group_member(uuid, uuid, text),
  public.leave_group_conversation(uuid), public.mark_conversation_read(uuid, uuid),
  public.get_conversation_summaries() to authenticated;

commit;
