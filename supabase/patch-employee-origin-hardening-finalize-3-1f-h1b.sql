-- Sprint 3.1F-H1b - Employee origin hardening (FINALIZE)
--
-- LOCAL ONLY nesta sprint. NÃO aplicar em produção sem release controlado.
-- Ordem obrigatória do release: (1) expand
-- patch-employee-origin-and-rewards-hardening-3-1f-h1.sql -> (2) deploy do código
-- que envia origin_kind explícito em todos os INSERTs -> (3) ESTA finalize.
--
-- Responsabilidade: remover o DEFAULT 'legacy' de referrals.origin_kind para que
-- a omissão futura de origin_kind falhe (trigger: origin_kind_required).
--
-- Garantias:
--  - não executa UPDATE/DELETE em referrals ou rewards (updated_at intacto);
--  - linhas existentes continuam lendo 'legacy' (o valor de metadata persiste
--    após DROP DEFAULT);
--  - não converte linhas legacy criadas durante a janela: apenas reporta CONTAGENS
--    (RAISE NOTICE, sem IDs/PII);
--  - fail-closed: RAISE EXCEPTION (rollback total) se a condição de segurança não
--    puder ser comprovada;
--  - reaplicável: se o DEFAULT já foi removido, repete as verificações e termina
--    como no-op.
--
-- Opcional (somente relatório): antes de aplicar, o operador pode informar o
-- instante de início do release para contar linhas legacy criadas na janela:
--   select set_config('igt.h1b_expand_started_at', '<timestamptz>', false);

begin;

do $$
declare
  v_attnum smallint;
  v_notnull boolean;
  v_default text;
  v_null_count bigint;
  v_invalid_count bigint;
  v_employee_bad bigint;
  v_employee_rewards bigint;
  v_window_start timestamptz;
  v_window_legacy bigint;
  r record;
begin
  -- 1. catálogo esperado
  select a.attnum, a.attnotnull
    into v_attnum, v_notnull
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.referrals'::regclass
    and a.attname = 'origin_kind'
    and not a.attisdropped;

  if v_attnum is null then
    raise exception 'h1b_finalize_abort: origin_kind column missing (apply expand first)';
  end if;
  if v_notnull is not true then
    raise exception 'h1b_finalize_abort: origin_kind is not NOT NULL';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.referrals'::regclass
      and conname = 'referrals_origin_kind_chk'
      and contype = 'c' and convalidated
  ) then
    raise exception 'h1b_finalize_abort: referrals_origin_kind_chk missing or not validated';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.referrals'::regclass
      and conname = 'referrals_employee_origin_no_reward_chk'
      and contype = 'c' and convalidated
  ) then
    raise exception 'h1b_finalize_abort: referrals_employee_origin_no_reward_chk missing or not validated';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.referrals'::regclass
      and tgname = 'trg_referrals_enforce_origin_kind'
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'h1b_finalize_abort: trg_referrals_enforce_origin_kind missing or disabled';
  end if;

  select pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    into v_default
  from pg_catalog.pg_attrdef d
  where d.adrelid = 'public.referrals'::regclass and d.adnum = v_attnum;

  if v_default is not null and v_default not in ('''legacy''::text', '''legacy''') then
    raise exception 'h1b_finalize_abort: unexpected origin_kind default %', v_default;
  end if;

  -- 2. dados (somente agregados)
  select count(*) into v_null_count from public.referrals where origin_kind is null;
  if v_null_count > 0 then
    raise exception 'h1b_finalize_abort: % referrals with NULL origin_kind', v_null_count;
  end if;

  select count(*) into v_invalid_count
  from public.referrals
  where origin_kind not in (
    'indicator', 'assisted_indicator', 'web_preregistration',
    'neutral_network', 'employee', 'legacy'
  );
  if v_invalid_count > 0 then
    raise exception 'h1b_finalize_abort: % referrals with invalid origin_kind', v_invalid_count;
  end if;

  select count(*) into v_employee_bad
  from public.referrals
  where origin_kind = 'employee'
    and (indicator_profile_id is not null or reward_eligible is distinct from false);
  if v_employee_bad > 0 then
    raise exception 'h1b_finalize_abort: % employee referrals violate invariants', v_employee_bad;
  end if;

  select count(*) into v_employee_rewards
  from public.rewards rw
  join public.referrals rf on rf.id = rw.referral_id
  where rf.origin_kind = 'employee';
  if v_employee_rewards > 0 then
    raise exception 'h1b_finalize_abort: % rewards point at employee referrals', v_employee_rewards;
  end if;

  -- 3. relatório agregado (sem IDs/PII)
  for r in
    select origin_kind, count(*) as n from public.referrals group by origin_kind order by origin_kind
  loop
    raise notice 'h1b_finalize_report origin_kind=% count=%', r.origin_kind, r.n;
  end loop;

  begin
    v_window_start := nullif(current_setting('igt.h1b_expand_started_at', true), '')::timestamptz;
  exception when others then
    raise exception 'h1b_finalize_abort: igt.h1b_expand_started_at is not a valid timestamptz';
  end;
  if v_window_start is not null then
    select count(*) into v_window_legacy
    from public.referrals
    where origin_kind = 'legacy' and created_at >= v_window_start;
    raise notice 'h1b_finalize_report legacy_created_in_release_window=% (review later; not converted)', v_window_legacy;
  else
    raise notice 'h1b_finalize_report legacy_created_in_release_window=UNKNOWN (igt.h1b_expand_started_at not set)';
  end if;

  if v_default is null then
    raise notice 'h1b_finalize_report default_already_removed=true (no-op)';
  end if;
end;
$$;

-- 4. remove o DEFAULT (no-op se já removido). Não toca linhas existentes.
alter table public.referrals alter column origin_kind drop default;
-- 5. NOT NULL e CHECK permanecem (verificados acima; reafirmado de forma idempotente).
alter table public.referrals alter column origin_kind set not null;

comment on column public.referrals.origin_kind is
  'Origem estrutural (3.1F-H1/H1b). Obrigatória e explícita em novos INSERTs (sem default após finalize). employee => sem indicador e sem reward. legacy => linhas anteriores ao discriminador (regras financeiras anteriores).';

commit;