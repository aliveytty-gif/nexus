begin;

alter table public.messages add column client_nonce uuid;
alter table public.messages add constraint messages_sender_conversation_nonce_key
  unique (sender_id, conversation_id, client_nonce);
grant insert (client_nonce) on public.messages to authenticated;

create function public.send_message(
  p_conversation_id uuid,
  p_client_nonce uuid,
  p_body text,
  p_attachments jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sender uuid := auth.uid();
  saved public.messages%rowtype;
begin
  if sender is null or not public.is_conversation_member(p_conversation_id) then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;
  if p_client_nonce is null then
    raise exception 'Message nonce required' using errcode = '22023';
  end if;

  -- A replay checks the existing row before running attachment validation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'message-send:' || sender::text || ':' || p_conversation_id::text || ':' || p_client_nonce::text, 0
  ));
  select * into saved from public.messages
  where sender_id = sender and conversation_id = p_conversation_id and client_nonce = p_client_nonce;

  if not found then
    insert into public.messages (conversation_id, sender_id, client_nonce, body, attachments)
    values (p_conversation_id, sender, p_client_nonce, p_body, p_attachments)
    on conflict on constraint messages_sender_conversation_nonce_key do nothing
    returning * into saved;

    if not found then
      select * into strict saved from public.messages
      where sender_id = sender and conversation_id = p_conversation_id and client_nonce = p_client_nonce;
    end if;
  end if;

  if saved.body is distinct from p_body or saved.attachments is distinct from p_attachments then
    raise exception 'Message nonce already used for another draft' using errcode = '23505';
  end if;
  return saved.id;
end;
$$;

revoke all on function public.send_message(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.send_message(uuid, uuid, text, jsonb) to authenticated;

commit;
