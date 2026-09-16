-- Lab local 3.1E-L — pré-requisitos para aplicar SQL versionado.
-- NÃO é migration de produção. Destino: PostgreSQL local descartável.
--
-- Simulado (não existe no Postgres vanilla):
-- - roles anon / authenticated / service_role (service_role BYPASSRLS)
-- - schema auth + auth.uid() via request.jwt.claim.sub
-- - public.profiles sem FK para auth.users
-- Funções current_user_role / is_admin_read_any vêm de supabase/rls-policies.sql
-- (corpo original; não são stubs always-true).

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'igt_local_only_not_prod';
  end if;
end$$;

grant anon, authenticated, service_role to authenticator;
grant pg_read_all_data, pg_write_all_data to service_role;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create schema if not exists storage;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now()),
  last_accessed_at timestamptz,
  metadata jsonb,
  path_tokens text[]
);
alter table storage.objects enable row level security;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

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

create table if not exists public.profiles (
  id uuid primary key,
  full_name text not null default 'fixture',
  email text not null unique,
  phone text not null default '00000000000',
  role public.user_role not null default 'funcionario',
  avatar_url text,
  cpf text,
  cnpj text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
$$;

create or replace function public.is_admin_read_any()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin_consulta', 'admin_financeiro', 'admin_master')
$$;
