-- Campos para futura criação de Interessado no ERP Controllr/BRByte.
-- Aplicar após patch-brbyte-sync-infrastructure.sql.
-- Aditivo: não altera triggers, RLS, rewards, wallet, pipeline ou SLA.

begin;

alter table public.referrals
  add column if not exists referred_document text,
  add column if not exists referred_rg text,
  add column if not exists referred_person_type text default 'pf',
  add column if not exists referred_zipcode text,
  add column if not exists referred_state text,
  add column if not exists referred_city text,
  add column if not exists referred_neighborhood text,
  add column if not exists referred_street text,
  add column if not exists referred_number text,
  add column if not exists referred_complement text,
  add column if not exists referred_observation text,
  add column if not exists erp_lead_source text default 'Indique e Ganhe',
  add column if not exists brbyte_id_interessado text,
  add column if not exists brbyte_interessado_status text,
  add column if not exists brbyte_interessado_created_at timestamptz,
  add column if not exists brbyte_interessado_last_sync_at timestamptz,
  add column if not exists brbyte_interessado_payload jsonb;

comment on column public.referrals.referred_document is
  'CPF/CNPJ do indicado (somente dígitos).';
comment on column public.referrals.referred_rg is
  'RG do indicado (opcional).';
comment on column public.referrals.referred_person_type is
  'Tipo de pessoa: pf (padrão) ou pj.';
comment on column public.referrals.referred_zipcode is
  'CEP do endereço de instalação (somente dígitos).';
comment on column public.referrals.referred_state is
  'UF do endereço de instalação.';
comment on column public.referrals.referred_city is
  'Cidade do endereço de instalação.';
comment on column public.referrals.referred_neighborhood is
  'Bairro do endereço de instalação.';
comment on column public.referrals.referred_street is
  'Logradouro do endereço de instalação.';
comment on column public.referrals.referred_number is
  'Número do endereço de instalação.';
comment on column public.referrals.referred_complement is
  'Complemento do endereço de instalação.';
comment on column public.referrals.referred_observation is
  'Observação livre sobre o indicado (formulário de indicação).';
comment on column public.referrals.erp_lead_source is
  'Origem do lead no ERP (padrão: Indique e Ganhe).';
comment on column public.referrals.brbyte_id_interessado is
  'ID do Interessado na BRByte após integração futura.';
comment on column public.referrals.brbyte_interessado_status is
  'Status do Interessado na BRByte após integração futura.';
comment on column public.referrals.brbyte_interessado_created_at is
  'Quando o Interessado foi criado na BRByte.';
comment on column public.referrals.brbyte_interessado_last_sync_at is
  'Última sincronização do Interessado com a BRByte.';
comment on column public.referrals.brbyte_interessado_payload is
  'Payload bruto da última operação de Interessado na BRByte.';

create index if not exists referrals_brbyte_id_interessado_idx
  on public.referrals (brbyte_id_interessado)
  where brbyte_id_interessado is not null;

create index if not exists referrals_referred_zipcode_idx
  on public.referrals (referred_zipcode)
  where referred_zipcode is not null;

commit;
