# 08 — Admin: perfil de remuneração `/admin/funcionarios/[id]/remuneracao` (seção H)

Wireframe: [`07-admin-perfil-remuneracao.html`](./wireframes/07-admin-perfil-remuneracao.html). Acesso: `admin_master | admin_financeiro`.
Base: RPC `configure_employee_compensation_draft`; tabela `employee_compensation_profiles` (versão, `status draft|active|inactive`, `foundation_inactive_chk` impede `active`).

## Campos

| Seção | Campos (mapeamento) | Regras |
|---|---|---|
| Vigência | `valid_from`, `valid_until?` | sem retroatividade; nova vigência = nova versão |
| Salário | Switch `salary_enabled`; `salary_amount` | valor > 0 quando habilitado |
| Vale diário | Switch `meal_enabled`; `meal_daily_amount` | botão "Usar sugestão R$ 22,00" (só preenche o campo; não é default) |
| Transporte | Switch `transport_enabled`; tipo `transport_method` (`monthly_fixed` = Valor mensal, `per_worked_day` = Valor diário); `transport_amount` | "Reembolso/ajuste manual" aparece desabilitado, como "futuro" (**gap**; hoje só via linha `adjustment`) |
| Combustível | idem `fuel_*` | idem |
| Outros componentes | — | **gap**: não há coluna; hoje só via linhas `other_earning`/`discount` na competência |
| Visibilidade | `show_salary`, `show_meal`, `show_transport`, `show_fuel` | só habilitável se o componente estiver habilitado (CHECK de visibilidade) |
| Status | sempre "Rascunho" | ativação inexistente nesta fase |

## Confirmação explícita

O botão **Salvar rascunho** abre um `AlertDialog` com o resumo dos valores e o
checkbox "Confirmo que revisei os valores desta versão". **Sem essa confirmação nada é salvo**, nem como rascunho automático.
Navegar para fora com alterações pendentes avisa "alterações não salvas" (não salva).

## Histórico de versões

Tabela: versão, vigência, componentes habilitados (ícones), status, criado
por, aprovado por e data. As versões são imutáveis (trigger
`trg_employee_compensation_profiles_immutable`). Para corrigir, cria-se uma nova versão.

## Catálogo `/admin/remuneracao/beneficios`

Página informativa com a lista de sugestões (Vale R$ 22/dia) e a contagem de
perfis por componente habilitado. Sem valores individuais na listagem.
