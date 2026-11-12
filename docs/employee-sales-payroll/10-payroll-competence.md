# 10 — Competência mensal `/admin/remuneracao/competencias[/id]` (seção J)

Wireframe: [`09-competencia.html`](./wireframes/09-competencia.html). Acesso: `admin_master | admin_financeiro`.

## Fluxo proposto × schema liberado

O fluxo proposto é `draft → calculated → reviewed → closed → paid`.

`payroll_competences_status_chk` liberado tem
**`draft, calculated, reviewed, closed, paid, reopened`**. O conjunto proposto
está contido no liberado. Diferenças:

| Item | Schema liberado | Desenho | Gap / ação futura |
|---|---|---|---|
| `reopened` | existe no enum | "Reabrir com motivo" | `trg_payroll_competences_guard` torna `closed/paid` **imutáveis**. Reabrir = criar **nova versão** (`version+1`, `is_current=true`, anterior `is_current=false`) com status inicial `reopened`→`draft`. Precisa de RPC futura (J7/J10) |
| Grafo de transição | **não há** trigger que force a ordem (só imutabilidade de closed/paid e o CHECK de metadados) | ordem estrita | Migration futura: trigger de transição (`draft→calculated→reviewed→closed→paid`; `calculated/reviewed→draft` ao recalcular) |
| `closed`, `paid` | bloqueados por `payroll_competences_foundation_no_close_pay_chk` | só desenho | remover o CHECK apenas em J10 autorizado |
| Totais | colunas `total_*`, `net_total` (default 0) | calculados das linhas | RPC de cálculo futura; hoje só `open_payroll_competence_draft` + `add_manual_payroll_adjustment` |
| Divergências | inexistente | painel de divergências | calculado em leitura (RPC futura), sem coluna nova |

Nenhuma migration nesta sprint.

## Tela de lista

Filtros: mês e status. Colunas: funcionário, período, salário, comissões,
benefícios, descontos, ajustes, total, status, divergências (contagem), atualizado em.

## Tela de detalhe

- **Cabeçalho:** funcionário, período "01/01/2027 a 31/01/2027 · America/Sao_Paulo", versão e status.
- **Blocos:** salário · comissões (por venda) · benefícios (vale, transporte, combustível) · outros ganhos · descontos · ajustes/estornos · **total**.
- **Divergências:**
  - venda com comissão `pending_evidence` no período;
  - dia trabalhado sem perfil vigente;
  - perfil alterado no meio do mês;
  - linha manual sem motivo.
- **Auditoria:** eventos `finance_audit_events` da competência.

## Ações futuras (todas desabilitadas nesta fase)

| Ação | Quem (recomendação) | Confirmação reforçada |
|---|---|---|
| Calcular | Admin Master ou Financeiro | `AlertDialog` simples; recalcular volta para `calculated` |
| Revisar | Admin Master ou Financeiro (de preferência ≠ quem calculou) | checkbox "Conferi divergências" |
| Fechar | Admin Financeiro (ou Master no fallback) **≠ quem revisou**, quando houver duas pessoas | digitar o mês ("2027-01") + total exibido + motivo opcional |
| Registrar pagamento | Admin Financeiro **≠ quem fechou** (fallback documentado) | digitar o total; data do pagamento; referência de comprovante sem dados bancários |
| Reabrir com motivo | Admin Master | motivo ≥ 10 caracteres; gera nova versão; notifica o funcionário |

Hoje estão disponíveis apenas: abrir competência em rascunho e adicionar
ajuste manual (RPCs existentes, ainda não ligadas a nenhuma UI).
