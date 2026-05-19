-- Coluna action_url (schema EN confirmado)
-- Aplicar se a coluna ainda não existir no projeto Supabase

begin;

alter table public.notifications
  add column if not exists action_url text;

create index if not exists notifications_action_url_idx
  on public.notifications (profile_id)
  where action_url is not null;

commit;
