-- =========================================================
-- Indique e Ganhe - Tanto Telecom
-- Schema completo para Supabase (PostgreSQL)
-- =========================================================

begin;

create extension if not exists "pgcrypto";

-- =========================================================
-- ENUMS
-- =========================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum (
      'indicador',
      'comercial',
      'funcionario',
      'admin_consulta',
      'admin_financeiro',
      'admin_master'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pix_key_type') then
    create type public.pix_key_type as enum ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'commercial_availability_status') then
    create type public.commercial_availability_status as enum ('disponivel', 'em_pausa', 'offline');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'referral_status') then
    create type public.referral_status as enum (
      'pendente',
      'em_andamento',
      'em_atendimento',
      'em_negociacao',
      'aprovada',
      'recusada',
      'paga'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'reward_type') then
    create type public.reward_type as enum ('pix', 'desconto_fatura');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'reward_status') then
    create type public.reward_status as enum ('pendente', 'disponivel', 'solicitado', 'pago', 'cancelado');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'wallet_transaction_type') then
    create type public.wallet_transaction_type as enum ('credito', 'debito', 'saque', 'desconto');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('pendente', 'aprovado', 'pago', 'cancelado', 'rejeitado');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_type') then
    create type public.notification_type as enum (
      'sistema',
      'indicacao',
      'pagamento',
      'recompensa',
      'carteira',
      'seguranca'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'audit_action') then
    create type public.audit_action as enum (
      'create',
      'update',
      'delete',
      'approve',
      'reject',
      'login',
      'logout'
    );
  end if;
end$$;

-- =========================================================
-- FUNCAO/TRIGGER PADRAO updated_at
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- =========================================================
-- TABELAS
-- =========================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  phone text not null,
  role public.user_role not null default 'indicador',
  avatar_url text,
  cpf text,
  cnpj text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_cpf_format_chk check (cpf is null or cpf ~ '^[0-9]{11}$'),
  constraint profiles_cnpj_format_chk check (cnpj is null or cnpj ~ '^[0-9]{14}$')
);

create unique index if not exists profiles_cpf_unique_idx
  on public.profiles(cpf)
  where cpf is not null;

create unique index if not exists profiles_cnpj_unique_idx
  on public.profiles(cnpj)
  where cnpj is not null;

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_active_idx on public.profiles(is_active);
create index if not exists profiles_email_lower_idx on public.profiles(lower(email));

create table if not exists public.pix_keys (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  key_type public.pix_key_type not null,
  key_value text not null,
  is_primary boolean not null default true,
  is_verified boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists pix_keys_key_value_unique_idx on public.pix_keys(key_value);
create unique index if not exists pix_keys_primary_per_profile_idx
  on public.pix_keys(profile_id)
  where is_primary = true;
create index if not exists pix_keys_profile_idx on public.pix_keys(profile_id);
create index if not exists pix_keys_type_idx on public.pix_keys(key_type);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  speed_label text not null,
  price numeric(10,2) not null check (price >= 0),
  description text,
  reward_amount numeric(10,2) not null check (reward_amount >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists plans_active_idx on public.plans(is_active);
create index if not exists plans_sort_order_idx on public.plans(sort_order);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  indicator_profile_id uuid not null references public.profiles(id) on delete restrict,
  referred_name text not null,
  referred_phone text not null,
  referred_email text,
  referred_address text,
  plan_id uuid not null references public.plans(id) on delete restrict,
  reward_type public.reward_type not null,
  reward_amount numeric(10,2) not null check (reward_amount >= 0),
  status public.referral_status not null default 'pendente',
  commercial_profile_id uuid references public.profiles(id) on delete set null,
  notes text,
  first_invoice_paid boolean not null default false,
  first_invoice_paid_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists referrals_indicator_idx on public.referrals(indicator_profile_id);
create index if not exists referrals_commercial_idx on public.referrals(commercial_profile_id);
create index if not exists referrals_plan_idx on public.referrals(plan_id);
create index if not exists referrals_status_idx on public.referrals(status);
create index if not exists referrals_created_at_idx on public.referrals(created_at desc);
create index if not exists referrals_referred_phone_idx on public.referrals(referred_phone);
create index if not exists referrals_referred_email_idx on public.referrals(lower(referred_email));

create table if not exists public.referral_history (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  old_status public.referral_status,
  new_status public.referral_status not null,
  action_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists referral_history_referral_idx on public.referral_history(referral_id);
create index if not exists referral_history_actor_idx on public.referral_history(actor_profile_id);
create index if not exists referral_history_created_at_idx on public.referral_history(created_at desc);

create table if not exists public.commercial_availability (
  id uuid primary key default gen_random_uuid(),
  commercial_profile_id uuid not null references public.profiles(id) on delete cascade,
  availability_status public.commercial_availability_status not null,
  available_from timestamptz,
  available_until timestamptz,
  reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint commercial_availability_window_chk
    check (available_until is null or available_from is null or available_until >= available_from)
);

create index if not exists commercial_availability_profile_idx
  on public.commercial_availability(commercial_profile_id);
create index if not exists commercial_availability_status_idx
  on public.commercial_availability(availability_status);
create index if not exists commercial_availability_time_idx
  on public.commercial_availability(available_from, available_until);

create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null unique references public.referrals(id) on delete cascade,
  indicator_profile_id uuid not null references public.profiles(id) on delete restrict,
  reward_type public.reward_type not null,
  amount numeric(10,2) not null check (amount >= 0),
  status public.reward_status not null default 'pendente',
  available_at timestamptz,
  requested_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists rewards_indicator_idx on public.rewards(indicator_profile_id);
create index if not exists rewards_status_idx on public.rewards(status);
create index if not exists rewards_available_at_idx on public.rewards(available_at);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  indicator_profile_id uuid not null references public.profiles(id) on delete restrict,
  reward_id uuid references public.rewards(id) on delete set null,
  payment_id uuid,
  transaction_type public.wallet_transaction_type not null,
  amount numeric(10,2) not null check (amount >= 0),
  balance_before numeric(10,2) not null default 0 check (balance_before >= 0),
  balance_after numeric(10,2) not null default 0 check (balance_after >= 0),
  description text not null,
  reference_code text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists wallet_transactions_indicator_idx
  on public.wallet_transactions(indicator_profile_id);
create index if not exists wallet_transactions_type_idx
  on public.wallet_transactions(transaction_type);
create index if not exists wallet_transactions_created_at_idx
  on public.wallet_transactions(created_at desc);
create index if not exists wallet_transactions_reward_idx
  on public.wallet_transactions(reward_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  indicator_profile_id uuid not null references public.profiles(id) on delete restrict,
  referral_id uuid references public.referrals(id) on delete restrict,
  reward_id uuid references public.rewards(id) on delete set null,
  amount numeric(10,2) not null check (amount >= 0),
  reward_type public.reward_type not null,
  status public.payment_status not null default 'pendente',
  due_date timestamptz not null,
  paid_at timestamptz,
  receipt_url text,
  notes text,
  approved_by_profile_id uuid references public.profiles(id) on delete set null,
  payment_kind text not null default 'referral_reward',
  rejection_reason text,
  pix_key_snapshot text,
  pix_key_type public.pix_key_type,
  wallet_debit_transaction_id uuid references public.wallet_transactions(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint payments_payment_kind_chk check (payment_kind in ('referral_reward', 'pix_withdrawal')),
  constraint payments_referral_kind_consistency_chk check (
    (payment_kind = 'referral_reward' and referral_id is not null)
    or (payment_kind = 'pix_withdrawal' and referral_id is null)
  )
);

create index if not exists payments_indicator_idx on public.payments(indicator_profile_id);
create index if not exists payments_referral_idx on public.payments(referral_id);
create index if not exists payments_reward_idx on public.payments(reward_id);
create index if not exists payments_status_idx on public.payments(status);
create index if not exists payments_due_date_idx on public.payments(due_date);
create index if not exists payments_approved_by_idx on public.payments(approved_by_profile_id);
create index if not exists payments_pix_withdrawal_status_idx
  on public.payments (payment_kind, status)
  where payment_kind = 'pix_withdrawal';

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  notification_type public.notification_type not null default 'sistema',
  title text not null,
  message text not null,
  data jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  action_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists notifications_profile_idx on public.notifications(profile_id);
create index if not exists notifications_unread_idx on public.notifications(profile_id, is_read);
create index if not exists notifications_created_at_idx on public.notifications(created_at desc);
create index if not exists notifications_type_idx on public.notifications(notification_type);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  target_profile_id uuid references public.profiles(id) on delete set null,
  entity_name text not null,
  entity_id text,
  action public.audit_action not null,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists audit_logs_actor_idx on public.audit_logs(actor_profile_id);
create index if not exists audit_logs_target_idx on public.audit_logs(target_profile_id);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_name, entity_id);
create index if not exists audit_logs_action_idx on public.audit_logs(action);
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);

-- =========================================================
-- AJUSTE DE FK ADIADA (wallet_transactions -> payments)
-- =========================================================
alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_payment_id_fkey;

alter table public.wallet_transactions
  add constraint wallet_transactions_payment_id_fkey
  foreign key (payment_id) references public.payments(id) on delete set null;

-- =========================================================
-- TRIGGERS updated_at
-- =========================================================

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_pix_keys_set_updated_at on public.pix_keys;
create trigger trg_pix_keys_set_updated_at
before update on public.pix_keys
for each row execute function public.set_updated_at();

drop trigger if exists trg_plans_set_updated_at on public.plans;
create trigger trg_plans_set_updated_at
before update on public.plans
for each row execute function public.set_updated_at();

drop trigger if exists trg_referrals_set_updated_at on public.referrals;
create trigger trg_referrals_set_updated_at
before update on public.referrals
for each row execute function public.set_updated_at();

drop trigger if exists trg_commercial_availability_set_updated_at on public.commercial_availability;
create trigger trg_commercial_availability_set_updated_at
before update on public.commercial_availability
for each row execute function public.set_updated_at();

drop trigger if exists trg_rewards_set_updated_at on public.rewards;
create trigger trg_rewards_set_updated_at
before update on public.rewards
for each row execute function public.set_updated_at();

drop trigger if exists trg_payments_set_updated_at on public.payments;
create trigger trg_payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists trg_notifications_set_updated_at on public.notifications;
create trigger trg_notifications_set_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();

commit;
