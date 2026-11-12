-- 3.1F-J2 rollback: remove SOMENTE as funções criadas por
-- patch-employee-read-rpcs-3-1f-j2.sql. Não toca tabelas, dados, policies
-- nem objetos financeiros de 3.1F-H1/I1. Aplicar somente com aprovação.
begin;
set local lock_timeout = '5s';
drop function if exists public.list_employee_competence_lines(date);
drop function if exists public.employee_compensation_summary(integer, integer);
drop function if exists public.get_employee_sale_detail(uuid);
drop function if exists public.list_employee_sales(integer, integer, text, date, date, text, text, text);
drop function if exists public.employee_sales_dashboard_summary(date);
drop function if exists public.employee_portal_line_kind(uuid);
drop function if exists public.employee_portal_line_visible(uuid);
drop function if exists public.employee_portal_mask_name(text);
drop function if exists public.employee_portal_self();
commit;
