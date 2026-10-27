# Sprint 3.1E-AW — Consolidação de casos duplicados por contrato

Status: implementação **local**. Nada aplicado remotamente. Sem push/deploy/Sync/ERP.

## Problema
Preflight 3.1E-AV: 3 casos `open`; 2 compartilham o mesmo `contract_pk` (faturas
distintas). Modelo antigo = um caso por fatura; AU exige um caso **ativo** por contrato.

Auditoria remota somente leitura (agregados): `AUTO_ONLY_SAFE_TO_CONSOLIDATE` —
só `created` + `auto_assign`, mesmo funcionário/setor, 0 contatos, 0 pagamentos.

## Modelo
- Status terminal `consolidated`: não ocupa capacidade, não é paid/cancelled/closed,
  não recebe contato/transferência/atribuição, aponta para o canônico.
- Colunas: `consolidated_into_case_id`, `consolidated_at`, `consolidation_reason`
  (`duplicate_invoice_cases_same_contract`), `consolidated_by`, `consolidation_operation_id`.
- Guardas: shape check, `into != id`, trigger (terminal, canônico não consolidado,
  mesmo contrato, sem cadeia/ciclo). Auditoria imutável `collection_case_consolidations`.
- RPC `consolidate_collection_cases_by_contract` (SECURITY DEFINER, search_path=public,
  service_role only): advisory lock por operação e por contrato (mesma chave do persist AU),
  FOR UPDATE em ordem de UUID, idempotente por `operation_id`, recusa lease ativa,
  trava de contato ativa, pagamento, atividade humana (modo auto), estado stale.
  Move as faturas para o canônico, marca o secundário, libera a assignment secundária
  (`released`, motivo `contract_case_consolidated`) sem avançar round-robin.
  Eventos permanecem no caso de origem (+1 `status_changed` no secundário). Run intocada.
- Política canônica: AUTO_ONLY → mais antigo (`created_at`, desempate UUID). Demais
  classificações → modo `explicit` com `p_actor_id`; pagamento → recusa sempre.

## Compatibilidade
- AR: instala `collection_case_invoices` com duplicatas; relatório de backfill (agora
  definido já na AR) separa `duplicateActiveContractGroups` de perda de fatura
  (`orphanCase`, `conflictingInvoice`, `unexplainedSkips`).
- AU: gate inicial aborta se houver contrato com >1 caso ativo.
- App: listas ignoram `consolidated`; canônico mostra todas as faturas e
  “Histórico consolidado”; detalhe do secundário é somente leitura com link para o ativo.

## Release futuro (NÃO executado; exige autorização específica)
1. Preflight read-only (grupo duplicado = 1, AUTO_ONLY, run paused/discovery gen=3, leases=0).
2. Aplicar AR.  3. `select collection_case_invoice_backfill_report()` — esperado:
   relations=3, orphanCase=0, conflictingInvoice=0, duplicateActiveContractGroups=1.
4. Aplicar AW.  5. Chamar UMA vez a RPC (`auto_oldest`, operation_id novo, status esperados `open`).
6. Verificar: ativos 3→2, consolidated 0→1, assignments ativas 3→2, faturas=3,
   created=3, payment_detected=0, run intacta, report duplicateActiveContractGroups=0.
7. Aplicar AU (gate passa).  8. Validar índice ativo por contrato.
9. Publicar código.  10. Smoke sem clicar “Carregar próxima leva”.  11. Parar sem Sync.
