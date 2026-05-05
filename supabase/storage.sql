-- =========================================================
-- Indique e Ganhe - Tanto Telecom
-- Storage (Supabase)
-- =========================================================
-- Este arquivo cria/configura o bucket privado de comprovantes
-- e aplica policies compatíveis com supabase/rls-policies.sql.
--
-- Pré-requisitos:
-- - funções auxiliares de role já criadas em public:
--   public.is_admin_read_any()
--   public.is_admin_write_any()
-- - autenticação Supabase ativa

begin;

-- =========================================================
-- BUCKET PRIVADO: payment-proofs
-- =========================================================
-- Aceita somente comprovantes:
-- - application/pdf
-- - image/jpeg
-- - image/png
-- - image/webp
--
-- Limite seguro adotado: 10 MB por arquivo.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  10485760, -- 10 MB
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- =========================================================
-- POLICIES DO STORAGE (storage.objects)
-- =========================================================
-- Convenção de path recomendada:
-- payment-proofs/{indicator_profile_id}/{payment_id}/{filename}
--
-- Regras de acesso:
-- - indicador: somente prefixo do próprio auth.uid()
-- - comercial: sem acesso aos comprovantes
-- - admin_consulta: leitura global
-- - admin_financeiro: leitura/escrita global
-- - admin_master: leitura/escrita global

-- Leitura (download/list)
drop policy if exists storage_payment_proofs_select on storage.objects;
create policy storage_payment_proofs_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    public.is_admin_read_any()
    or split_part(name, '/', 1) = auth.uid()::text
  )
);

-- Upload
drop policy if exists storage_payment_proofs_insert on storage.objects;
create policy storage_payment_proofs_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payment-proofs'
  and (
    public.is_admin_write_any()
    or split_part(name, '/', 1) = auth.uid()::text
  )
);

-- Update/replace/move
drop policy if exists storage_payment_proofs_update on storage.objects;
create policy storage_payment_proofs_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    public.is_admin_write_any()
    or split_part(name, '/', 1) = auth.uid()::text
  )
)
with check (
  bucket_id = 'payment-proofs'
  and (
    public.is_admin_write_any()
    or split_part(name, '/', 1) = auth.uid()::text
  )
);

-- Delete
drop policy if exists storage_payment_proofs_delete on storage.objects;
create policy storage_payment_proofs_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    public.is_admin_write_any()
    or split_part(name, '/', 1) = auth.uid()::text
  )
);

commit;
