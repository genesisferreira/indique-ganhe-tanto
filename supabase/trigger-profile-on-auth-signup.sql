-- =========================================================
-- Opcional: criar linha em public.profiles ao registrar em auth.users
-- =========================================================
-- Use este script no SQL Editor do Supabase se:
-- - "Confirm email" estiver ATIVO no Auth (signUp não devolve sessão), e
-- - você quiser que o perfil base exista mesmo antes do primeiro login.
--
-- O fluxo no app (cadastro) continua preferindo upsert com JWT quando há sessão.
-- Esta função roda como SECURITY DEFINER e ignora RLS de forma segura:
-- só insere id = NEW.id (o mesmo UUID recem criado em auth.users).
--
-- Metadados: passe em signUp options.data (full_name, phone) — já enviados pelo app.

begin;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full text;
  v_phone text;
begin
  v_full := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'Indicador');
  v_phone := coalesce(nullif(trim(new.raw_user_meta_data->>'phone'), ''), '—');

  insert into public.profiles (id, full_name, email, phone, role, is_active)
  values (
    new.id,
    v_full,
    coalesce(new.email, ''),
    v_phone,
    'indicador',
    true
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row
  execute function public.handle_new_user_profile();

commit;
