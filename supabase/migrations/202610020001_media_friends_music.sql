begin;

-- Direct friendship requests; each unordered pair has at most one relationship.
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
create unique index friendships_pair_idx on public.friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_requester_idx on public.friendships(requester_id, created_at desc);
create index friendships_addressee_idx on public.friendships(addressee_id, created_at desc);
create trigger friendships_set_updated_at before update on public.friendships
  for each row execute function public.set_updated_at();

alter table public.friendships enable row level security;
revoke all on public.friendships from public, anon, authenticated;
grant select, delete on public.friendships to authenticated;
grant insert (requester_id, addressee_id, status) on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;

create policy friendships_read_participant on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
create policy friendships_request_self on public.friendships for insert to authenticated
  with check (requester_id = (select auth.uid()) and status = 'pending');
create policy friendships_accept_recipient on public.friendships for update to authenticated
  using (addressee_id = (select auth.uid()) and status = 'pending')
  with check (addressee_id = (select auth.uid()) and status = 'accepted');
create policy friendships_remove_participant on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- Extend the existing private attachment system to audio.
alter table public.messages drop constraint messages_attachment_fields;
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
      'application/zip', 'application/x-zip-compressed', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'
    )
    and attachment_size between 1 and 10485760
  ))
);
create or replace function public.can_access_message_file(p_path text, p_own boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_path is null or p_path !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_][A-Za-z0-9._-]{0,179}\.(jpg|jpeg|png|webp|pdf|txt|doc|docx|zip|mp3|m4a|wav)$'
  then return false; end if;
  return (not p_own or split_part(p_path, '/', 2) = auth.uid()::text)
    and public.is_conversation_member(split_part(p_path, '/', 1)::uuid);
end;
$$;
revoke all on function public.can_access_message_file(text, boolean) from public, anon, authenticated;
grant execute on function public.can_access_message_file(text, boolean) to authenticated;

update storage.buckets set allowed_mime_types = array_cat(allowed_mime_types, array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']) where id = 'message-files';

create table public.audio_tracks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  artist text not null default '' check (char_length(artist) <= 200),
  file_path text not null unique check (char_length(file_path) <= 256),
  duration double precision check (duration >= 0 and duration < 'Infinity'::float8),
  created_at timestamptz not null default now()
);
create index audio_tracks_owner_created_idx on public.audio_tracks(owner_id, created_at desc);
create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create index playlists_owner_idx on public.playlists(owner_id);
create table public.playlist_tracks (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id uuid not null references public.audio_tracks(id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  added_at timestamptz not null default now(),
  primary key (playlist_id, track_id)
);
create index playlist_tracks_track_idx on public.playlist_tracks(track_id);

alter table public.audio_tracks enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
revoke all on public.audio_tracks, public.playlists, public.playlist_tracks from public, anon, authenticated;
grant select, delete on public.audio_tracks, public.playlists, public.playlist_tracks to authenticated;
grant insert (owner_id, title, artist, file_path, duration) on public.audio_tracks to authenticated;
grant insert (owner_id, name) on public.playlists to authenticated;
grant insert (playlist_id, track_id, position) on public.playlist_tracks to authenticated;
create policy audio_read_authenticated on public.audio_tracks for select to authenticated using ((select auth.uid()) is not null);
create policy audio_insert_self on public.audio_tracks for insert to authenticated with check (owner_id = (select auth.uid()));
create policy audio_delete_self on public.audio_tracks for delete to authenticated using (owner_id = (select auth.uid()));
create policy playlists_read_own on public.playlists for select to authenticated using (owner_id = (select auth.uid()));
create policy playlists_insert_own on public.playlists for insert to authenticated with check (owner_id = (select auth.uid()));
create policy playlists_delete_own on public.playlists for delete to authenticated using (owner_id = (select auth.uid()));
create policy playlist_tracks_read_own on public.playlist_tracks for select to authenticated using (
  exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = (select auth.uid()))
);
create policy playlist_tracks_insert_own on public.playlist_tracks for insert to authenticated with check (
  exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = (select auth.uid()))
);
create policy playlist_tracks_delete_own on public.playlist_tracks for delete to authenticated using (
  exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = (select auth.uid()))
);

-- New shared music library is authenticated-only; personal message files remain separate.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 52428800,
  array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'])
on conflict (id) do nothing;
create policy nexus_audio_read on storage.objects for select to authenticated using (
  bucket_id = 'audio' and (
    split_part(name, '/', 1) = (select auth.uid())::text or
    exists (select 1 from public.audio_tracks t where t.file_path = name)
  )
);
create policy nexus_audio_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'audio' and split_part(name, '/', 1) = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_][A-Za-z0-9._-]{0,159}\.(mp3|m4a|wav)$'
);
create policy nexus_audio_delete on storage.objects for delete to authenticated using (
  bucket_id = 'audio' and split_part(name, '/', 1) = (select auth.uid())::text
);
-- No update grants/policy: uploaded objects and registered paths cannot be moved or overwritten.
create function public.validate_audio_track() returns trigger
language plpgsql security definer set search_path = '' as $$
declare metadata jsonb;
begin
  if auth.uid() is null or new.owner_id <> auth.uid()
    or split_part(new.file_path, '/', 1) <> auth.uid()::text
    or new.file_path !~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_][A-Za-z0-9._-]{0,159}\.(mp3|m4a|wav)$'
  then raise exception 'Invalid audio owner or path' using errcode = '42501'; end if;
  select o.metadata into metadata from storage.objects o where o.bucket_id = 'audio' and o.name = new.file_path;
  if not found or coalesce(metadata->>'size', '') !~ '^[0-9]{1,8}$'
    or coalesce(metadata->>'mimetype', '') not in ('audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave')
  then raise exception 'Audio missing or invalid metadata' using errcode = '23514'; end if;
  if (metadata->>'size')::bigint not between 1 and 52428800 then
    raise exception 'Audio exceeds size limit' using errcode = '23514'; end if;
  return new;
end;
$$;
revoke all on function public.validate_audio_track() from public, anon, authenticated;
create trigger audio_tracks_validate before insert on public.audio_tracks for each row execute function public.validate_audio_track();

commit;
