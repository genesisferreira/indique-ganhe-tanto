# Cobrança 3.1E-AU — lote operacional por contrato

## Unidade operacional
- OPERATIONAL_UNIT=distinct_contract · CASE_UNIT=contract · INVOICE_UNIT=invoice
- CUSTOMER_DEDUPLICATION_SCOPE=contract_only · CLIENT_PK_REQUIRED=NO

## Limitação formal
- client_pk não foi comprovado em invoice/list (3.1E-AS: inconclusivo por timeout).
- client_pk não foi comprovado em invoice_info.
- Não há consulta oficial contract→client no repositório (3.1E-AT).
- Nunca usar nome, CPF/CNPJ, telefone, endereço ou e-mail como chave.
- Um cliente com dois contratos pode aparecer em dois blocos.
- Cada contrato tem no máximo um caso operacional ativo; todas as faturas do contrato aparecem juntas.
- Nenhum contato simultâneo para o mesmo contrato (trava transacional por contract_pk).

Texto na UI: “Os atendimentos são agrupados por contrato. Clientes com mais de um contrato podem aparecer em blocos separados.”

## Migrations (somente local nesta sprint)
1. `supabase/patch-collection-ar-operational-batch.sql` — collection_case_invoices, backfill, cursor monotônico.
2. `supabase/patch-collection-au-contract-batch.sql` — caso ativo único por contrato, persistência por contrato,
   reconciliação por fatura (pagamento parcial), trava de contato por contrato, capacidade, relatório de backfill.

Contrato que volta a ficar inadimplente após caso fechado → novo ciclo (novo caso); histórico preservado.

## Plano de release controlado (não executado)
1. Release review deste branch.
2. Em janela controlada: aplicar AR e AU (nessa ordem), transacionais.
3. Ler `collection_case_invoice_backfill_report()`; abortar se `contractsWithMultipleActiveCases > 0`
   ou se os três casos atuais não estiverem vinculados.
4. Só então publicar o código (a persistência usa `persist_collection_contract_invoice` e é fail-closed sem a migration).
5. Conferir `collection_contract_capacity_summary()`; primeira “Carregar próxima leva” com autorização explícita.

## Rollback
- Não apagar casos, eventos, assignments ou vínculos de fatura sem auditoria.
- Código: voltar à RPC `persist_collection_discovery_invoice` (mantida).
- Rollback de código não desfaz efeitos persistidos.
