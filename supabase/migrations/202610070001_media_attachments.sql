-- Multiple private attachments; the existing single message attachment and post image stay compatible.
begin;

alter table public.messages add column attachments jsonb not null default '[]'::jsonb;
alter table public.posts add column attachments jsonb not null default '[]'::jsonb;

alter table public.messages add constraint messages_attachments_array check (
  case when jsonb_typeof(attachments) = 'array' then jsonb_array_length(attachments) <= 10 else false end
);
alter table public.posts add constraint posts_attachments_array check (
  case when jsonb_typeof(attachments) = 'array' then jsonb_array_length(attachments) <= 10 else false end
);
alter table public.messages drop constraint messages_body_length;
alter table public.messages add constraint messages_body_length check (
  char_length(body) <= 5000 and (body ~ '[^[:space:]]' or attachment_path is not null or attachments <> '[]'::jsonb)
);
alter table public.posts drop constraint posts_content_length;
alter table public.posts add constraint posts_content_length check (
  char_length(content) <= 5000 and (content ~ '[^[:space:]]' or attachments <> '[]'::jsonb)
);
grant insert (attachments) on public.messages to authenticated;
grant insert (attachments), update (attachments) on public.posts to authenticated;

-- Keep the previous ownership/membership check and only extend its safe path allowlist.
create or replace function public.can_access_message_file(p_path text, p_own boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_path is null or p_path !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_][A-Za-z0-9._-]{0,179}\.(jpg|jpeg|png|webp|pdf|txt|doc|docx|zip|mp3|m4a|wav|mp4|webm)$'
  then return false; end if;
  return (not p_own or split_part(p_path, '/', 2) = auth.uid()::text)
    and public.is_conversation_member(split_part(p_path, '/', 1)::uuid);
end;
$$;
revoke all on function public.can_access_message_file(text, boolean) from public, anon, authenticated;
grant execute on function public.can_access_message_file(text, boolean) to authenticated;

update storage.buckets set allowed_mime_types = array_cat(allowed_mime_types, array['video/mp4', 'video/webm'])
  where id = 'message-files';
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-files', 'post-files', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip', 'application/x-zip-compressed', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a',
  'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'video/mp4', 'video/webm'
])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Every new attachment is validated before reading privileged Storage metadata.
create function public.validate_media_attachments() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  attachment jsonb;
  object_metadata jsonb;
  file_path text;
  file_name text;
  file_type text;
  extension text;
  prefix text;
  bucket text;
  seen_paths text[] := array[]::text[];
begin
  if jsonb_typeof(new.attachments) is distinct from 'array' then
    raise exception 'Attachments must be an array of at most 10 files' using errcode = '23514';
  end if;
  if jsonb_array_length(new.attachments) > 10 then
    raise exception 'Attachments must be an array of at most 10 files' using errcode = '23514';
  end if;
  -- Editing text must still work if an already attached object was removed by its owner.
  if tg_op = 'UPDATE' and new.attachments = old.attachments then
    if tg_table_name = 'messages' then
      if new.sender_id = old.sender_id and new.conversation_id = old.conversation_id then return new; end if;
    else
      if new.author_id = old.author_id then return new; end if;
    end if;
  end if;
  if new.attachments = '[]'::jsonb then return new; end if;

  if tg_table_name = 'messages' then
    if auth.uid() is null or new.sender_id <> auth.uid() or not public.is_conversation_member(new.conversation_id) then
      raise exception 'Attachments do not belong to this sender and conversation' using errcode = '42501';
    end if;
    prefix := new.conversation_id::text || '/' || new.sender_id::text || '/';
    bucket := 'message-files';
  else
    if auth.uid() is null or new.author_id <> auth.uid() then
      raise exception 'Attachments do not belong to this author' using errcode = '42501';
    end if;
    prefix := new.author_id::text || '/';
    bucket := 'post-files';
  end if;

  for attachment in select value from jsonb_array_elements(new.attachments) loop
    if jsonb_typeof(attachment) is distinct from 'object'
      or jsonb_typeof(attachment->'path') is distinct from 'string'
      or jsonb_typeof(attachment->'name') is distinct from 'string'
      or jsonb_typeof(attachment->'type') is distinct from 'string'
      or jsonb_typeof(attachment->'size') is distinct from 'number'
      or attachment - array['path', 'name', 'type', 'size'] <> '{}'::jsonb
      or (attachment->>'size') !~ '^[0-9]{1,8}$' then
      raise exception 'Invalid attachment fields' using errcode = '23514';
    end if;
    file_path := attachment->>'path';
    file_name := attachment->>'name';
    file_type := attachment->>'type';
    if left(file_path, char_length(prefix)) <> prefix
      or substring(file_path from char_length(prefix) + 1) !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_][A-Za-z0-9._-]{0,179}\.(jpg|jpeg|png|webp|pdf|txt|doc|docx|zip|mp3|m4a|wav|mp4|webm)$' then
      raise exception 'Invalid attachment owner or path' using errcode = '42501';
    end if;
    if file_path = any(seen_paths) then
      raise exception 'Duplicate attachment path' using errcode = '23514';
    end if;
    seen_paths := array_append(seen_paths, file_path);
    extension := substring(file_path from '\.([^.]+)$');
    if char_length(file_name) not between 1 and 255 or file_name ~ '[/\\[:cntrl:]]'
      or file_name !~ '[^[:space:]]' or lower(substring(file_name from '\.([^.]+)$')) is distinct from extension
      or (attachment->>'size')::bigint not between 1 and 10485760
      or not (case extension
        when 'jpg' then file_type = 'image/jpeg'
        when 'jpeg' then file_type = 'image/jpeg'
        when 'png' then file_type = 'image/png'
        when 'webp' then file_type = 'image/webp'
        when 'pdf' then file_type = 'application/pdf'
        when 'txt' then file_type = 'text/plain'
        when 'doc' then file_type = 'application/msword'
        when 'docx' then file_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        when 'zip' then file_type in ('application/zip', 'application/x-zip-compressed')
        when 'mp3' then file_type in ('audio/mpeg', 'audio/mp3')
        when 'm4a' then file_type in ('audio/mp4', 'audio/x-m4a')
        when 'wav' then file_type in ('audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave')
        when 'mp4' then file_type = 'video/mp4'
        when 'webm' then file_type = 'video/webm'
        else false end) then
      raise exception 'Invalid attachment filename, MIME or size' using errcode = '23514';
    end if;
    select o.metadata into object_metadata from storage.objects o where o.bucket_id = bucket and o.name = file_path;
    if not found or object_metadata->>'mimetype' is distinct from file_type
      or coalesce(object_metadata->>'size', '') !~ '^[0-9]{1,8}$' then
      raise exception 'Attachment is missing or its metadata is invalid' using errcode = '23514';
    end if;
    if (object_metadata->>'size')::bigint <> (attachment->>'size')::bigint then
      raise exception 'Attachment size does not match Storage' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.validate_media_attachments() from public, anon, authenticated;
create trigger messages_validate_attachments before insert or update of attachments, sender_id, conversation_id
  on public.messages for each row execute function public.validate_media_attachments();
create trigger posts_validate_attachments before insert or update of attachments, author_id
  on public.posts for each row execute function public.validate_media_attachments();

create index posts_attachments_path_idx on public.posts using gin (attachments jsonb_path_ops);
-- This query runs as the caller, so a referenced file is readable only through a post that passes posts RLS.
create policy nexus_post_files_read on storage.objects for select to authenticated using (
  bucket_id = 'post-files' and (select auth.uid()) is not null
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_][A-Za-z0-9._-]{0,179}\.(jpg|jpeg|png|webp|pdf|txt|doc|docx|zip|mp3|m4a|wav|mp4|webm)$'
  and (split_part(name, '/', 1) = (select auth.uid())::text or exists (
    select 1 from public.posts p where p.attachments @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
  ))
);
create policy nexus_post_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'post-files' and split_part(name, '/', 1) = (select auth.uid())::text
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_][A-Za-z0-9._-]{0,179}\.(jpg|jpeg|png|webp|pdf|txt|doc|docx|zip|mp3|m4a|wav|mp4|webm)$'
);
create policy nexus_post_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'post-files' and split_part(name, '/', 1) = (select auth.uid())::text
);
-- No UPDATE policy: uploaded files cannot be overwritten or moved to another owner.

commit;
