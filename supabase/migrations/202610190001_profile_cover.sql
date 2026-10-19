-- Profile covers reuse public avatars Storage and the existing owner UPDATE policy.
begin;

alter table public.profiles
  add column cover_url text,
  add constraint profiles_cover_url_format check (
    cover_url is null
    or (char_length(cover_url) <= 2048 and cover_url ~ '^https://[^[:space:]]+$')
  );

grant update (cover_url) on public.profiles to authenticated;

commit;
