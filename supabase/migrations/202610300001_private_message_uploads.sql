-- Keep drafts private to their uploader; publication reuses existing message/avatar references.
begin;

create index messages_attachment_path_idx on public.messages (attachment_path)
  where attachment_path is not null;
create index messages_attachments_path_idx on public.messages using gin (attachments jsonb_path_ops);

-- Keep INSERT/DELETE and metadata-validation helpers unchanged. They must still accept
-- the owner's upload before a message exists. Read referenced rows as the caller, under RLS.
alter policy nexus_message_files_read on storage.objects using (
  case when bucket_id = 'message-files' and public.can_access_message_file(name, false) then
    split_part(name, '/', 2) = (select auth.uid())::text
    or exists (
      select 1 from public.messages m
      where m.conversation_id = split_part(storage.objects.name, '/', 1)::uuid
        and m.sender_id = split_part(storage.objects.name, '/', 2)::uuid
        and (m.attachment_path = storage.objects.name
          or m.attachments @> jsonb_build_array(jsonb_build_object('path', storage.objects.name)))
    )
    or exists (
      select 1 from public.conversations c
      where c.id = split_part(storage.objects.name, '/', 1)::uuid
        and c.kind = 'group' and c.avatar_path = storage.objects.name
    )
  else false end
);

-- Already issued signed URLs remain bearer links until expiry/cache invalidation.
-- Abandoned uploads stay owner-only; never delete them merely because a send timed out.
commit;
