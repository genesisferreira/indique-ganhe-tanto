-- Garante tabelas na publicação supabase_realtime (necessário para reload do indicador sem F5).
-- Executar no SQL Editor se realtime não disparar eventos.

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise notice 'Publication supabase_realtime não encontrada — configure no dashboard Supabase.';
    return;
  end if;

  alter publication supabase_realtime add table public.referrals;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.rewards;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.wallet_transactions;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.payments;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
end $$;
