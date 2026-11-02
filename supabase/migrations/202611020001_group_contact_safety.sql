-- Serialize contact changes with group admission, including blocks between non-creator members.
begin;

-- Internal only. Sorted per-user keys keep lock work linear in group size.
-- The two-int namespace is separate from existing bigint direct/dating pair locks.
-- Each RPC acquires one complete user set; future batch RPCs must preserve that order.
create function public.lock_contact_users(p_user_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare lock_id integer;
begin
  for lock_id in
    select distinct pg_catalog.hashtext(user_id::text)
      from pg_catalog.unnest(p_user_ids) as users(user_id)
      where user_id is not null order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(781223, lock_id);
  end loop;
end;
$$;
revoke all on function public.lock_contact_users(uuid[]) from public, anon, authenticated;

create or replace function public.set_user_block(p_user_id uuid, p_blocked boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_user_id is null or p_user_id = actor or p_blocked is null then
    raise exception 'Choose another user' using errcode = '22023';
  end if;
  perform public.lock_contact_users(array[actor, p_user_id]);
  perform pg_advisory_xact_lock(hashtextextended(least(actor,p_user_id)::text || ':' || greatest(actor,p_user_id)::text, 0));
  if p_blocked then
    insert into public.user_blocks(blocker_id, blocked_id) values (actor, p_user_id) on conflict do nothing;
  else
    delete from public.user_blocks where blocker_id = actor and blocked_id = p_user_id;
  end if;
end;
$$;

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
  perform public.lock_contact_users(array_append(members, actor));
  if exists (select 1 from public.user_blocks
    where blocker_id = any(array_append(members, actor))
      and blocked_id = any(array_append(members, actor))) then
    raise exception 'Group unavailable' using errcode = '42501';
  end if;
  insert into public.conversations (kind, title) values ('group', btrim(p_title)) returning id into result_id;
  insert into public.conversation_members (conversation_id, user_id, role) values (result_id, actor, 'creator');
  insert into public.conversation_members (conversation_id, user_id)
    select result_id, member_id from unnest(members) member_id;
  return result_id;
end;
$$;

create or replace function public.manage_group_member(p_conversation_id uuid, p_user_id uuid, p_action text)
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
    perform public.lock_contact_users(array_append(
      array(select user_id from public.conversation_members where conversation_id = p_conversation_id), p_user_id));
    if exists (select 1 from public.user_blocks b
      join public.conversation_members m on m.conversation_id = p_conversation_id
        and ((b.blocker_id = p_user_id and b.blocked_id = m.user_id)
          or (b.blocked_id = p_user_id and b.blocker_id = m.user_id))) then
      raise exception 'Group unavailable' using errcode = '42501';
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

-- Existing RPC contracts and authenticated-only access are unchanged.
revoke all on function public.create_group_conversation(text, uuid[]),
  public.manage_group_member(uuid, uuid, text), public.set_user_block(uuid, boolean) from public, anon;
grant execute on function public.create_group_conversation(text, uuid[]),
  public.manage_group_member(uuid, uuid, text), public.set_user_block(uuid, boolean) to authenticated;
commit;
