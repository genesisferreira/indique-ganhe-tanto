# 05 — Minhas vendas `/funcionario/vendas` e detalhe (seção E)

Wireframes: [`03-minhas-vendas.html`](./wireframes/03-minhas-vendas.html), [`04-detalhe-venda.html`](./wireframes/04-detalhe-venda.html).

## Lista

| Coluna | Fonte / regra |
|---|---|
| Data | `referrals.created_at` (dd/mm/aaaa, America/Sao_Paulo) |
| Interessado (sanitizado) | primeiro nome + inicial do sobrenome ("Maria S."); telefone mascarado `(11) •••••-1234` |
| Plano/interesse | nome do plano |
| Status comercial | `referral_status` com mapa próprio; **`paga` nunca é exibida** (não se aplica a esta origem) |
| Etapa | `pipeline_stage` (Novo, Tentativa de contato, … Ativado, Perdido) |
| Seu papel | Técnico originador / Vendedor externo / Responsável interno |
| Situação da comissão | "Regras não ativas" (hoje) · Aguardando evidência · Apurada · Aprovada · Incluída na competência · Paga com a folha · Estornada · Rejeitada |
| Competência | `AAAA-MM` ou "—" |
| Última atualização | `updated_at` relativo ("há 2 dias") |

**Filtros:** período (mês ou intervalo), status, etapa, situação da comissão,
competência. **Paginação:** keyset por `(created_at desc, id)`, 20 por página.
**Mobile:** cada linha vira um card empilhado (interessado, etapa e badge de comissão); filtros em `Sheet`.

## Detalhe

1. **Cabeçalho:** interessado sanitizado, plano, seu papel, badges de status e etapa.
2. **Linha do tempo** (reaproveita o padrão "Histórico"): criada → em
   atendimento → negociação → aprovada pelo comercial → conversão confirmada
   pelo ERP (só com evidência) → comissão (estados) → competência.
3. **Dados permitidos:** bairro/cidade, plano, data e observação que o próprio funcionário escreveu.
4. **Acompanhamento comercial:** etapa, se há responsável interno (nome
   só se for o próprio usuário; caso contrário "Atribuído") e retornos agendados (data apenas).
5. **Instalação/conversão:** "Aguardando comprovação" até existir evidência ERP; nunca inferir de `aprovada`.
6. **Evidência financeira resumida:** "Fatura gerada: comprovada / não comprovada" e "Fatura paga: comprovada / não comprovada". **Fatura ausente = "não comprovada", nunca "não paga".**
7. **Comissão:** método e valor **somente do próprio papel**, status e competência.
8. **Ajustes/estornos:** valor, data e motivo resumido.
9. **Histórico:** eventos de auditoria do próprio registro (sem ator nominal de outros funcionários).

## Nunca mostrar

Payload ERP, `contract_pk`/`invoice_pk`, notas internas restritas, valores ou
papéis remunerados de outros funcionários, dados financeiros do cliente
(valor de fatura, débito), CPF completo, ids técnicos internos (UUID só na URL, opaco).
