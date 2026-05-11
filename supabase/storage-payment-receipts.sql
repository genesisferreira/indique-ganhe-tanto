-- Bucket público (somente leitura anônima via URL) para comprovantes de saque Pix.
-- Upload restrito a admin_financeiro / admin_master (is_admin_write_any).
-- Aplicar após supabase/rls-policies.sql (funções de role).

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'payment-receipts',
  'payment-receipts',
  true,
  10485760,
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

-- Leitura: URLs públicas do bucket (indicador abre comprovante sem sessão)
drop policy if exists storage_payment_receipts_select on storage.objects;
create policy storage_payment_receipts_select
on storage.objects
for select
to public
using (bucket_id = 'payment-receipts');

-- Upload apenas financeiro/master, sempre sob pix-withdrawals/
drop policy if exists storage_payment_receipts_insert on storage.objects;
create policy storage_payment_receipts_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payment-receipts'
  and public.is_admin_write_any()
  and name like 'pix-withdrawals/%'
);

drop policy if exists storage_payment_receipts_update on storage.objects;
create policy storage_payment_receipts_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'payment-receipts'
  and public.is_admin_write_any()
)
with check (
  bucket_id = 'payment-receipts'
  and public.is_admin_write_any()
);

drop policy if exists storage_payment_receipts_delete on storage.objects;
create policy storage_payment_receipts_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'payment-receipts'
  and public.is_admin_write_any()
);

commit;
