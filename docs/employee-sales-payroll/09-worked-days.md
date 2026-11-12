# 09 — Dias trabalhados `/admin/remuneracao/dias-trabalhados` (seção I)

Wireframe: [`08-dias-trabalhados.html`](./wireframes/08-dias-trabalhados.html). Acesso: `admin_master | admin_financeiro`.
Base: RPC `record_employee_worked_day(p_operation_id, p_employee_id, p_work_date, p_status, p_meal_eligible)`; tabela `employee_worked_days`, com UNIQUE (employee_id, work_date).

## Grade mensal

- **Linhas:** funcionários (filtro por setor e gestor). **Colunas:** dias 1…último do mês (America/Sao_Paulo); fim de semana sombreado.
- **Célula:** código do status + marcador de vale.

| Status UI | Valor no banco | Vale possível |
|---|---|---|
| Trabalhado | `worked` | sim (`meal_eligible`) |
| Falta | `absent` | não |
| Férias | `vacation` | não |
| Afastamento | `leave` | não |
| Feriado | `holiday` | não |
| Compensado | `compensated` | não |

`employee_worked_days_meal_chk` só permite vale com `worked`.

- **Elegível para vale:** checkbox na célula (padrão desmarcado; nenhum dia é marcado automaticamente).
- **Origem:** `source` (hoje só `manual_rpc` → "Manual").
- **Responsável:** `recorded_by` (nome do admin) e data, no tooltip.
- **Totais por linha:** dias trabalhados, dias elegíveis para vale e faltas.

## Ações

| Ação | Comportamento |
|---|---|
| Marcar individualmente | Clique na célula → `Popover` com status + vale → "Salvar dia" (gera `operation_id`) |
| Operação em lote | Seleção de intervalo/funcionários → resumo "N dias de M funcionários serão marcados como X" → `AlertDialog` com digitação do número de dias → N chamadas idempotentes (uma por dia) |
| Copiar calendário | Copia o padrão do mês anterior **apenas para a tela** (rascunho visual, destacado); nada é gravado até "Salvar marcações" com confirmação |
| Depois da competência revisada | A célula mostra cadeado amarelo; a alteração vira **ajuste** (pede motivo) — ver gap |
| Depois da competência fechada/paga | Edição direta bloqueada (`competence_closed_requires_adjustment` no banco); só ajuste na competência seguinte |
| Dia já referenciado por linha de folha | Bloqueado (`worked_day_referenced_by_payroll_line`) |

**Gap:** o banco bloqueia só `closed/paid`. A regra "após `reviewed` gera
ajuste" precisa de guarda futura (migration J6) ou de uma regra de UI + RPC.
