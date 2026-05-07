begin;

alter table public.referrals
  add column if not exists assigned_at timestamptz,
  add column if not exists first_response_at timestamptz,
  add column if not exists last_interaction_at timestamptz,
  add column if not exists redistribution_count integer not null default 0,
  add column if not exists admin_alerted boolean not null default false;

commit;
