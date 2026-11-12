# Vendas e remuneração de funcionários — especificação de UX e fluxo (Sprint 3.1F-J1)

> **Fase 3A — somente desenho.** Esta pasta não implementa telas, endpoints,
> migrations, RPCs, regras nem automações. Nada aqui é servido pelo Next.js
> (`docs/` fica fora de `app/` e `public/`).

## Baseline

| Item | Valor |
|---|---|
| origin/main = Production | `fce7f5d526b17ca3f078634fe696425f6dc82bae` |
| Fundação estrutural | liberada (8 tabelas, 7 RPCs só `authenticated`, todas vazias) |
| Regras financeiras ativas | 0 (CHECK `*_foundation_inactive_chk` impede) |
| `ERP_FIRST_INVOICE_ORDER_PROVEN` | **NO** |
| `ERP_PAID_AMOUNT_PROVEN` | **NO** |
| `COMMISSION_AUTOMATION_ALLOWED` | **NO** |

Referência técnica da fundação: [`../employee-commission-payroll-ledger.md`](../employee-commission-payroll-ledger.md).

## Índice

| # | Documento | Seção do brief |
|---|---|---|
| 01 | [Auditoria visual e de navegação](./01-ui-audit.md) | A |
| 02 | [Mapa de rotas e conflitos](./02-routes.md) | B |
| 03 | [Painel do funcionário](./03-employee-dashboard.md) | C |
| 04 | [Nova oportunidade](./04-new-opportunity.md) | D |
| 05 | [Minhas vendas](./05-sales-tracking.md) | E |
| 06 | [Remuneração do funcionário](./06-employee-compensation.md) | F |
| 07 | [Admin — regras de comissão](./07-admin-rules.md) | G |
| 08 | [Admin — perfil de remuneração](./08-admin-compensation-profile.md) | H |
| 09 | [Dias trabalhados](./09-worked-days.md) | I |
| 10 | [Competência mensal](./10-payroll-competence.md) | J |
| 11 | [Permissões e segregação de funções](./11-permissions.md) | K |
| 12 | [Contratos de API propostos](./12-api-contracts.md) | L |
| 13 | [Estados e terminologia](./13-terminology.md) | M |
| 14 | [Fluxos (Mermaid)](./14-flows.md) | — |
| 15 | [Plano de implementação J2–J10](./15-implementation-plan.md) | O |
| — | [Wireframes estáticos](./wireframes/index.html) | N |

## Decisões-chave (resumo)

1. **Namespace administrativo próprio: `/admin/remuneracao/*`** em vez de
   `/admin/financeiro/*`. Hoje `/admin/financeiro` é a página **Recompensas** do
   Indique e Ganhe ("Total em Comissões", "Saldo Disponível"). Aninhar a folha
   de funcionários ali misturaria carteira/saque com remuneração (stop rule P).
   Novo grupo de menu: **REMUNERAÇÃO DA EQUIPE**. Ver [02](./02-routes.md).
2. **`admin_consulta` não acessa remuneração.** O middleware atual libera
   `/admin/*` para `admin_consulta`; as rotas novas precisam de guarda explícita
   `admin_master | admin_financeiro`.
3. **"Gestor" não é um papel de login**: é o funcionário referenciado em
   `employees.manager_employee_id`. Ele vê vendas da equipe sem nenhum valor.
4. **"Interessados" = `referrals.status='pendente'` + `pipeline_stage='novo'`**
   (coluna "Novo" do kanban). Não existe item de menu "Interessados"; criar o
   interessado no ERP continua sendo ação separada e não é disparada.
5. Toda leitura financeira do funcionário depende de **RPCs de leitura futuras**
   (as 7 tabelas novas não têm SELECT para `authenticated`).
6. Valores R$30 / R$50 / 2% / R$22 são **apenas sugestões visuais** que
   preenchem o formulário quando o Admin clica; nunca default de banco.

## Wireframes

`wireframes/*.html` — HTML estático, CSS local, **zero JavaScript**, sem
`fetch`, dados marcados **DADOS SINTÉTICOS**. Abrir localmente no navegador.
Não são importados por `app/`, `components/` ou `lib/` e não entram no bundle.

## Questões de produto em aberto

| # | Questão | Proposta padrão |
|---|---|---|
| Q1 | O técnico/vendedor externo escolhe o responsável interno no cadastro, ou só o Admin/Comercial atribui depois? | Só Admin atribui (RPC existente); o funcionário pode **sugerir** (J3, campo informativo) |
| Q2 | Duplicidade por telefone/documento bloqueia ou só avisa? Qual janela? | Bloqueia se houver oportunidade em aberto com o mesmo telefone; avisa se ela estiver encerrada há menos de 90 dias |
| Q3 | Funcionário com várias funções: o papel principal é escolhido a cada cadastro ou fica fixo no cadastro do funcionário? | Escolha por cadastro, com padrão = primeira membership elegível |
| Q4 | Outros ganhos e descontos ficam sempre visíveis ao funcionário? | Sim, quando houver linha (transparência de descontos) |
| Q5 | O Gestor pode propor dias trabalhados? | Não na Fase 3; reavaliar depois de J9 |
| Q6 | Renomear o grupo de menu "Financeiro" para "Financeiro — Indique e Ganhe"? | Sim, junto com J5 |
| Q7 | Transporte/combustível por reembolso? | Fora da Fase 3; usar ajuste manual com motivo |
