-- Joining a group requires the recipient's consent. Existing memberships are unchanged.
begin;

create table public.group_invitations (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  inviter_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (conversation_id, invitee_id),
  foreign key (conversation_id, inviter_id)
    references public.conversation_members(conversation_id, user_id) on delete cascade,
  check (invitee_id <> inviter_id)
);
create index group_invitations_recipient_created_idx
  on public.group_invitations(invitee_id, created_at desc, conversation_id);
alter table public.group_invitations enable row level security;
revoke all on public.group_invitations from public, anon, authenticated;
grant select on public.group_invitations to authenticated;
create policy group_invitations_read_recipient on public.group_invitations for select
  to authenticated using (invitee_id = (select auth.uid()));

create or replace function public.create_group_conversation(p_title text, p_member_ids uuid[])
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
  -- Preserve Contact Safety checks for every selected pair, including two invitees.
  perform public.lock_contact_users(array_append(members, actor));
  if exists (select 1 from public.user_blocks
    where blocker_id = any(array_append(members, actor))
      and blocked_id = any(array_append(members, actor))) then
    raise exception 'Group unavailable' using errcode = '42501';
  end if;
  insert into public.conversations (kind, title) values ('group', btrim(p_title)) returning id into result_id;
  insert into public.conversation_members (conversation_id, user_id, role) values (result_id, actor, 'creator');
  insert into public.group_invitations (conversation_id, invitee_id, inviter_id)
    select result_id, member_id, actor from unnest(members) member_id;
  return result_id;
end;
$$;

create or replace function public.manage_group_member(p_conversation_id uuid, p_user_id uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  target_role text;
begin
  perform 1 from public.conversations where id = p_conversation_id and kind = 'group' for update;
  if not found then raise exception 'Group unavailable' using errcode = '42501'; end if;
  select role into actor_role from public.conversation_members
    where conversation_id = p_conversation_id and user_id = actor;
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
    perform public.lock_contact_users(array_append(
      array(select user_id from public.conversation_members where conversation_id = p_conversation_id), p_user_id));
    if exists (select 1 from public.user_blocks b
      join public.conversation_members m on m.conversation_id = p_conversation_id
        and ((b.blocker_id = p_user_id and b.blocked_id = m.user_id)
          or (b.blocked_id = p_user_id and b.blocker_id = m.user_id))) then
      raise exception 'Group unavailable' using errcode = '42501';
    end if;
    -- Existing members stay members; no self-invitations or replacement of pending senders.
    if target_role is not null then return; end if;
    insert into public.group_invitations (conversation_id, invitee_id, inviter_id)
      values (p_conversation_id, p_user_id, actor)
      on conflict (conversation_id, invitee_id) do nothing;
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

-- A pending invitation exposes only its minimal preview, never group history or the roster.
create function public.get_group_invitations()
returns table (
  conversation_id uuid, title text, inviter_id uuid, inviter_username text,
  inviter_first_name text, inviter_last_name text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  return query
    select i.conversation_id, c.title, i.inviter_id, p.username, p.first_name, p.last_name, i.created_at
    from public.group_invitations i
    join public.conversations c on c.id = i.conversation_id and c.kind = 'group'
    join public.profiles p on p.id = i.inviter_id
    where i.invitee_id = actor
    order by i.created_at desc, i.conversation_id
    limit 50;
end;
$$;

create function public.respond_to_group_invitation(p_conversation_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  inviter uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_conversation_id is null or p_accept is null then
    raise exception 'Invalid invitation response' using errcode = '22023';
  end if;
  -- All invitation/membership changes take the group row first, then the full user set.
  -- Never lock the invitation first: inviter removal cascades to this row under the group lock.
  perform 1 from public.conversations where id = p_conversation_id and kind = 'group' for update;
  if not found then return; end if;
  select i.inviter_id into inviter from public.group_invitations i
    where i.conversation_id = p_conversation_id and i.invitee_id = actor for update;
  if not found then return; end if; -- Retrying accept/decline or responding to an expired invite is harmless.
  if not p_accept then
    delete from public.group_invitations where conversation_id = p_conversation_id and invitee_id = actor;
    return;
  end if;
  if exists (select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = actor) then
    delete from public.group_invitations where conversation_id = p_conversation_id and invitee_id = actor;
    return;
  end if;
  if not exists (select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = inviter and role in ('creator', 'admin')) then
    raise exception 'Group unavailable' using errcode = '42501';
  end if;
  perform public.lock_contact_users(array_append(
    array(select user_id from public.conversation_members where conversation_id = p_conversation_id), actor));
  if exists (select 1 from public.user_blocks b
    join public.conversation_members m on m.conversation_id = p_conversation_id
      and ((b.blocker_id = actor and b.blocked_id = m.user_id)
        or (b.blocked_id = actor and b.blocker_id = m.user_id))) then
    raise exception 'Group unavailable' using errcode = '42501';
  end if;
  insert into public.conversation_members (conversation_id, user_id) values (p_conversation_id, actor)
    on conflict (conversation_id, user_id) do nothing;
  delete from public.group_invitations where conversation_id = p_conversation_id and invitee_id = actor;
end;
$$;

revoke all on function public.create_group_conversation(text, uuid[]), public.manage_group_member(uuid, uuid, text),
  public.get_group_invitations(), public.respond_to_group_invitation(uuid, boolean) from public, anon, authenticated;
grant execute on function public.create_group_conversation(text, uuid[]), public.manage_group_member(uuid, uuid, text),
  public.get_group_invitations(), public.respond_to_group_invitation(uuid, boolean) to authenticated;
commit;
