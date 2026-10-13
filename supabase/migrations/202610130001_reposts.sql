-- Reposts reference the original post; media and source text are never copied.
begin;

alter table public.posts add column is_repost boolean not null default false;
alter table public.posts add column original_post_id uuid references public.posts(id) on delete set null;
alter table public.posts add constraint posts_repost_shape check (
  (not is_repost and original_post_id is null)
  or (is_repost and community_id is null and image_url is null and attachments = '[]'::jsonb)
);
alter table public.posts drop constraint posts_content_length;
alter table public.posts add constraint posts_content_length check (
  char_length(content) <= 5000 and (is_repost or content ~ '[^[:space:]]' or attachments <> '[]'::jsonb)
);
create unique index posts_author_original_unique on public.posts (author_id, original_post_id) where is_repost;
create index posts_original_post_idx on public.posts (original_post_id) where is_repost;
-- Clients may insert a valid reference, but cannot change it or turn a normal post into a repost.
grant insert (is_repost, original_post_id) on public.posts to authenticated;

create function public.validate_post_repost() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare source_is_repost boolean;
begin
  if tg_op = 'UPDATE' then
    if new.is_repost is distinct from old.is_repost
      or new.author_id is distinct from old.author_id then
      raise exception 'Post kind and author are immutable' using errcode = '23514';
    end if;
    if new.original_post_id is distinct from old.original_post_id then
      -- Only the FK's nested ON DELETE SET NULL may create a tombstone.
      if not (pg_trigger_depth() > 1 and old.original_post_id is not null and new.original_post_id is null) then
        raise exception 'Repost reference is immutable' using errcode = '23514';
      end if;
    end if;
  elsif new.is_repost then
    select p.is_repost into source_is_repost from public.posts p where p.id = new.original_post_id;
    if not found then raise exception 'Original post is unavailable' using errcode = 'P0002'; end if;
    if source_is_repost then raise exception 'Repost must reference the original post' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_post_repost() from public, anon, authenticated;
create trigger posts_guard_repost before insert or update on public.posts
  for each row execute function public.validate_post_repost();

create function public.create_repost(p_original_post_id uuid, p_comment text default '') returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  source public.posts%rowtype;
  result uuid;
  comment_text text := btrim(coalesce(p_comment, ''));
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if char_length(comment_text) > 5000 then raise exception 'Comment is too long' using errcode = '22023'; end if;
  -- Both reads use the caller's RLS; a visible repost cannot expose an unavailable original.
  select * into source from public.posts where id = p_original_post_id;
  if not found then raise exception 'Original post is unavailable' using errcode = 'P0002'; end if;
  if source.is_repost then
    select * into source from public.posts where id = source.original_post_id;
    if not found or source.is_repost then raise exception 'Original post is unavailable' using errcode = 'P0002'; end if;
  end if;
  insert into public.posts (author_id, content, is_repost, original_post_id)
    values (auth.uid(), comment_text, true, source.id)
    on conflict (author_id, original_post_id) where is_repost do nothing returning id into result;
  if result is null then
    select id into result from public.posts where author_id = auth.uid() and original_post_id = source.id and is_repost;
  end if;
  return result;
end;
$$;
revoke all on function public.create_repost(uuid, text) from public, anon;
grant execute on function public.create_repost(uuid, text) to authenticated;

create function public.get_repost_summaries(p_post_ids uuid[])
returns table (post_id uuid, repost_count bigint, my_repost_id uuid)
language sql stable security invoker set search_path = '' as $$
  with requested as (
    select p.id, case when p.is_repost then p.original_post_id else p.id end as original_id
    from public.posts p where p.id = any(p_post_ids)
  )
  select requested.id, count(r.id),
    (max(r.id::text) filter (where r.author_id = auth.uid()))::uuid
  from requested
  left join public.posts original on original.id = requested.original_id and not original.is_repost
  left join public.posts r on r.original_post_id = original.id and r.is_repost
  group by requested.id;
$$;
revoke all on function public.get_repost_summaries(uuid[]) from public, anon;
grant execute on function public.get_repost_summaries(uuid[]) to authenticated;

commit;
