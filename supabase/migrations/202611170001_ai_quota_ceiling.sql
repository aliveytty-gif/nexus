-- Support high-volume free-model accounts while preserving the configured daily
-- quotas, the rolling minute limit, cooldown, and per-run reservation rules.
begin;
set local lock_timeout = '5s';

alter table public.ai_quota_settings
  drop constraint ai_quota_settings_user_limit_check,
  drop constraint ai_quota_settings_global_limit_check,
  add constraint ai_quota_settings_user_limit_check check (user_limit between 0 and 1000),
  add constraint ai_quota_settings_global_limit_check check (global_limit between 0 and 1000);

alter table public.ai_user_usage
  drop constraint ai_user_usage_attempts_check,
  add constraint ai_user_usage_attempts_check check (attempts between 0 and 1000);

alter table public.ai_global_usage
  drop constraint ai_global_usage_attempts_check,
  add constraint ai_global_usage_attempts_check check (attempts between 0 and 1000);

commit;
