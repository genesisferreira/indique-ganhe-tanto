-- =========================================================
-- AUTH 1C — profile + Pix no cadastro (metadata do signUp)
-- =========================================================
-- Evolui public.handle_new_user_profile() já aplicada em produção.
-- Profile + Pix (quando metadata válida) na mesma transação do INSERT em auth.users.
--
-- Metadata esperada em raw_user_meta_data (signUp options.data):
--   full_name, phone, pix_key_type, pix_key_value
--
-- Regras Pix:
--   - metadata AUSENTE (type e value vazios): apenas profile (outros fluxos)
--   - metadata PARCIAL (só type ou só value): RAISE invalid_pix_metadata
--   - metadata COMPLETA com tipo inválido: RAISE invalid_pix_key_type
--   - metadata COMPLETA com valor inválido: RAISE invalid_pix_key_value
--   - metadata COMPLETA e válida: profile + pix_keys
--
-- Segurança:
--   - profile_id sempre = NEW.id (nunca lê profile_id da metadata)
--   - Pix duplicada em outro usuário → RAISE (rollback do signup)
--   - UNIQUE(key_value) permanece como proteção contra race condition
--   - Nunca ON CONFLICT DO UPDATE que troque profile_id
--
-- Trigger on_auth_user_created_profile NÃO é recriado (CREATE OR REPLACE preserva vínculo).

begin;

-- Validação CPF (11 dígitos + verificadores; rejeita sequências iguais).
-- Espelha lib/client/formatters.ts → isValidCPF.
create or replace function public.is_valid_cpf_digits(p_cpf text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_cpf text;
  v_sum integer;
  v_remainder integer;
  v_i integer;
begin
  v_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  if length(v_cpf) <> 11 then
    return false;
  end if;
  if v_cpf ~ '^(\d)\1{10}$' then
    return false;
  end if;

  v_sum := 0;
  for v_i in 1..9 loop
    v_sum := v_sum + (substring(v_cpf, v_i, 1)::integer * (11 - v_i));
  end loop;
  v_remainder := (v_sum * 10) % 11;
  if v_remainder = 10 then
    v_remainder := 0;
  end if;
  if v_remainder <> substring(v_cpf, 10, 1)::integer then
    return false;
  end if;

  v_sum := 0;
  for v_i in 1..10 loop
    v_sum := v_sum + (substring(v_cpf, v_i, 1)::integer * (12 - v_i));
  end loop;
  v_remainder := (v_sum * 10) % 11;
  if v_remainder = 10 then
    v_remainder := 0;
  end if;
  return v_remainder = substring(v_cpf, 11, 1)::integer;
end;
$$;

-- Validação CNPJ (14 dígitos + verificadores; rejeita sequências iguais).
-- Espelha lib/client/formatters.ts → isValidCNPJ.
create or replace function public.is_valid_cnpj_digits(p_cnpj text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_cnpj text;
  v_weights1 integer[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  v_weights2 integer[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  v_sum integer;
  v_remainder integer;
  v_digit1 integer;
  v_digit2 integer;
  v_i integer;
begin
  v_cnpj := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  if length(v_cnpj) <> 14 then
    return false;
  end if;
  if v_cnpj ~ '^(\d)\1{13}$' then
    return false;
  end if;

  v_sum := 0;
  for v_i in 1..12 loop
    v_sum := v_sum + (substring(v_cnpj, v_i, 1)::integer * v_weights1[v_i]);
  end loop;
  v_remainder := v_sum % 11;
  v_digit1 := case when v_remainder < 2 then 0 else 11 - v_remainder end;
  if v_digit1 <> substring(v_cnpj, 13, 1)::integer then
    return false;
  end if;

  v_sum := 0;
  for v_i in 1..13 loop
    v_sum := v_sum + (substring(v_cnpj, v_i, 1)::integer * v_weights2[v_i]);
  end loop;
  v_remainder := v_sum % 11;
  v_digit2 := case when v_remainder < 2 then 0 else 11 - v_remainder end;
  return v_digit2 = substring(v_cnpj, 14, 1)::integer;
end;
$$;

-- Normaliza e valida chave Pix do cadastro indicador.
-- Regras alinhadas a lib/auth/pix-key-validation.ts e lib/client/formatters.ts.
create or replace function public.validate_indicator_signup_pix_key(
  p_type_raw text,
  p_value_raw text
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_type text;
  v_value text;
  v_digits text;
begin
  v_type := nullif(trim(coalesce(p_type_raw, '')), '');
  v_value := nullif(trim(coalesce(p_value_raw, '')), '');

  if v_type is null or v_value is null then
    raise exception 'invalid_pix_metadata'
      using errcode = '22023';
  end if;

  if v_type not in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria') then
    raise exception 'invalid_pix_key_type'
      using errcode = '22023';
  end if;

  if v_type = 'cpf' then
    v_digits := regexp_replace(v_value, '\D', '', 'g');
    if not public.is_valid_cpf_digits(v_digits) then
      raise exception 'invalid_pix_key_value'
        using errcode = '22023';
    end if;
    return v_digits;
  end if;

  if v_type = 'cnpj' then
    v_digits := regexp_replace(v_value, '\D', '', 'g');
    if not public.is_valid_cnpj_digits(v_digits) then
      raise exception 'invalid_pix_key_value'
        using errcode = '22023';
    end if;
    return v_digits;
  end if;

  if v_type = 'email' then
    v_value := lower(v_value);
    if v_value !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
      raise exception 'invalid_pix_key_value'
        using errcode = '22023';
    end if;
    return v_value;
  end if;

  if v_type = 'telefone' then
    v_digits := regexp_replace(v_value, '\D', '', 'g');
    if length(v_digits) >= 12 and left(v_digits, 2) = '55' then
      v_digits := substring(v_digits from 3);
    end if;
    if length(v_digits) > 11 then
      v_digits := right(v_digits, 11);
    end if;
    if length(v_digits) not in (10, 11) then
      raise exception 'invalid_pix_key_value'
        using errcode = '22023';
    end if;
    return v_digits;
  end if;

  -- aleatoria: UUID com hífens (padrão Bacen; alinhado a lib/auth/pix-key-validation.ts).
  v_value := lower(v_value);
  if v_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_pix_key_value'
      using errcode = '22023';
  end if;
  return v_value;
end;
$$;

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
  v_pix_value_raw text;
  v_pix_key_type public.pix_key_type;
  v_pix_value_norm text;
  v_existing_profile_id uuid;
  v_existing_primary_value text;
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
  v_pix_value_raw := nullif(trim(new.raw_user_meta_data->>'pix_key_value'), '');

  if v_pix_type_raw is null and v_pix_value_raw is null then
    return new;
  end if;

  if v_pix_type_raw is null or v_pix_value_raw is null then
    raise exception 'invalid_pix_metadata'
      using errcode = '22023';
  end if;

  v_pix_value_norm := public.validate_indicator_signup_pix_key(v_pix_type_raw, v_pix_value_raw);
  v_pix_key_type := v_pix_type_raw::public.pix_key_type;

  select pk.key_value
    into v_existing_primary_value
  from public.pix_keys pk
  where pk.profile_id = new.id
    and pk.is_primary = true
  limit 1;

  if v_existing_primary_value is not null then
    if v_existing_primary_value = v_pix_value_norm then
      return new;
    end if;
    raise exception 'pix_primary_already_exists'
      using errcode = '23505';
  end if;

  select pk.profile_id
    into v_existing_profile_id
  from public.pix_keys pk
  where pk.key_value = v_pix_value_norm
  limit 1;

  if v_existing_profile_id is not null then
    if v_existing_profile_id <> new.id then
      raise exception 'pix_key_already_registered'
        using errcode = '23505';
    end if;
    return new;
  end if;

  insert into public.pix_keys (profile_id, key_type, key_value, is_primary)
  values (new.id, v_pix_key_type, v_pix_value_norm, true);

  return new;
end;
$$;

commit;
