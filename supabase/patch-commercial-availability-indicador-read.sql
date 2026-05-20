-- Permite ao indicador listar comerciais com availability_status = 'disponivel'
-- para auto-atribuição no cadastro de indicação (insertIndicadorReferral).
-- Aplicar no SQL Editor se a indicação ficar sempre sem comercial atribuído.

begin;

drop policy if exists commercial_availability_select_policy on public.commercial_availability;
create policy commercial_availability_select_policy
on public.commercial_availability
for select
to authenticated
using (
  commercial_profile_id = auth.uid()
  or public.is_admin_read_any()
  or (
    public.is_indicator()
    and availability_status = 'disponivel'
  )
);

commit;
