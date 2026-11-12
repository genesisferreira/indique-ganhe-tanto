# 06 — Minha remuneração `/funcionario/remuneracao[/AAAA-MM]` (seção F)

Wireframe: [`05-minha-remuneracao.html`](./wireframes/05-minha-remuneracao.html).

## Resumo mensal (cards)

| Item | Regra de exibição | Fonte futura |
|---|---|---|
| Competência | sempre ("Janeiro/2027 · 01/01 a 31/01") | `payroll_competences.period_start/end`, America/Sao_Paulo |
| Comissão | sempre (é o componente base de `employee_compensation_visible_components`) | linhas `commission` |
| Salário | só se `salary_enabled && show_salary` | linha `base_salary` |
| Vale | só se `meal_enabled && show_meal` | linhas `meal` (1 por dia elegível) |
| Transporte | só se `transport_enabled && show_transport` | linha `transport` |
| Combustível | só se `fuel_enabled && show_fuel` | linha `fuel` |
| Outros ganhos | só se houver linha `other_earning` | |
| Descontos | só se houver linha `discount` | |
| Total previsto | `net_total` com status `draft/calculated/reviewed` | rótulo "Previsto — em apuração" |
| Total fechado | `net_total` com status `closed/paid` | rótulo "Fechado" |
| Status | badge da competência | ver [10](./10-payroll-competence.md) |

> Componente não configurado **não aparece** (nem como R$ 0,00).
> **Gap:** o perfil não tem flag `show_*` para outros ganhos e descontos.
> Proposta: exibir sempre quando houver linha, porque o funcionário precisa ver
> um desconto aplicado. Decisão Q4.

## Detalhamento

- **Comissões:** uma linha por venda remunerada (interessado sanitizado, papel
  exercido, método — Fixo / Percentual / Primeira fatura —, valor, status e
  ajuste/estorno vinculado).
- **Vale:** "{dias elegíveis} dias × R$ {valor diário} = R$ {total}" e a lista
  de dias elegíveis (expansível).
- **Transporte/combustível:** "Mensal fixo" ou "{n} dias × R$ {valor}"
  (`per_worked_day`).
- **Outros ganhos / descontos / ajustes / estornos:** descrição e motivo resumido.

## Mensagens fixas

- "Valores em apuração não são pagamento confirmado."
- "Competência fechada não significa transferência bancária realizada."
- "O pagamento é registrado pelo Financeiro e acontece junto com o salário."
- **Não existe botão de saque**, carteira, Pix nem "saldo disponível".

## Estados vazios

- Sem competência aberta: "A competência deste mês ainda não foi aberta pelo Financeiro."
- Sem perfil: "Sua remuneração ainda não foi configurada. Fale com o administrador." (mostra só as comissões, se houver).
- Regras inativas (hoje): "Regras de comissão aguardam a validação da integração financeira."
