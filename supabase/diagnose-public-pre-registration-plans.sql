-- Diagnóstico: planos disponíveis para pré-cadastro público
-- Executar no SQL Editor do Supabase (schema public.plans)

select
  id,
  name,
  speed_label,
  is_active,
  sort_order
from public.plans
order by name;
