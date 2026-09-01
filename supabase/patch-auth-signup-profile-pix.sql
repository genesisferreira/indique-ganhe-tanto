-- =========================================================
-- AUTH 1C — profile + Pix no cadastro (metadata do signUp)
-- =========================================================
-- Evolui public.handle_new_user_profile() já aplicada em produção.
-- Profile + Pix (quando metadata válida) na mesma transação do INSERT em auth.users.
--
-- Metadata esperada em raw_user_meta_data (signUp options.data):
--   full_name, phone, pix_key_type, pix_key_value
--
-- Segurança:
--   - profile_id sempre = NEW.id (nunca lê profile_id da metadata)
--   - Pix duplicada em outro usuário → RAISE (rollback do signup)
--   - Pix vazia ou tipo inválido → ignora Pix, mantém profile
--   - Sem metadata Pix → apenas profile (compatível com outros fluxos)

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
  v_pix_type_raw text;
  v_pix_value text;
  v_pix_key_type public.pix_key_type;
  v_existing_profile_id uuid;
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

  v_pix_type_raw := nullif(trim(new.raw_user_meta_data->>'pix_key_type'), '');
  v_pix_value := nullif(trim(new.raw_user_meta_data->>'pix_key_value'), '');

  if v_pix_type_raw is null or v_pix_value is null then
    return new;
  end if;

  if v_pix_type_raw not in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria') then
    raise exception 'invalid_pix_key_type'
      using errcode = '22023';
  end if;

  v_pix_key_type := v_pix_type_raw::public.pix_key_type;

  select pk.profile_id
    into v_existing_profile_id
  from public.pix_keys pk
  where pk.key_value = v_pix_value
  limit 1;

  if v_existing_profile_id is not null then
    if v_existing_profile_id <> new.id then
      raise exception 'pix_key_already_registered'
        using errcode = '23505';
    end if;
    return new;
  end if;

  insert into public.pix_keys (profile_id, key_type, key_value, is_primary)
  values (new.id, v_pix_key_type, v_pix_value, true);

  return new;
end;
$$;

-- Trigger já existe em produção; garantir binding à função atualizada.
drop trigger if exists on_auth_user_created_profile on auth.users;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row
  execute function public.handle_new_user_profile();

commit;
