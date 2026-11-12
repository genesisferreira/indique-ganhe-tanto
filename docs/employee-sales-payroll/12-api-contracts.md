# 12 — Contratos de API propostos (seção L) — **sem código nesta sprint**

## Regras gerais (todos os endpoints)

- **Autenticação:** cookie de sessão Supabase. O Route Handler cria o client
  com o **JWT do usuário** (`createClient()` server) e chama a RPC.
  **Proibido usar `service_role` para agir em nome de um usuário.** As RPCs
  dependem de `auth.uid()`; com service_role, `auth.uid()` é nulo e a RPC
  devolve `forbidden`/`unauthenticated`.
- **Autorização:** papel revalidado no handler (defesa em profundidade) **e** dentro da RPC (`finance_admin_actor_role()` ou `role = funcionario`).
- **Escrita:** `Idempotency-Key` (header, `^[A-Za-z0-9_-]{16,128}$`) repassada à RPC. Repetição → `200` com `idempotent:true`.
- **Erros:** `{ ok:false, code, message }` com mensagem pt-BR amigável e sem detalhe SQL.

| HTTP | `code` |
|---|---|
| 400 | `invalid_payload`, `invalid_*` |
| 401 | `unauthenticated` |
| 403 | `forbidden`, `employee_not_active`, `membership_not_active` |
| 404 | `not_found` (inclusive para recurso de outro funcionário: não revelar que existe) |
| 409 | `idempotency_conflict`, `attribution_role_taken`, `employee_already_attributed`, `attribution_conflict` |
| 422 | `financial_rules_inactive`, `invalid_percentage_rate`, `competence_closed_requires_adjustment` |
| 503 | `temporarily_unavailable` |

- **Paginação:** keyset `?cursor=<opaco>&limit=20` (máx. 50). Resposta `{ items, nextCursor }`.
- **Logs:** registrar `route`, `role`, `code`, `duration_ms` e `request_id`. Proibido logar nome, telefone, documento, valores, `contract_pk`/`invoice_pk` ou payload.
- **Sanitização:** nome do interessado → "Maria S."; telefone mascarado; nunca CPF, payload ERP ou ids ERP.
- **Cache:** `Cache-Control: no-store` em todo endpoint financeiro.

## Funcionário

| Endpoint | Método | Papel | Input | Output sanitizado | Pag. | Idem. | RPC |
|---|---|---|---|---|---|---|---|
| `/api/employee/sales-opportunities` | POST | funcionario ativo + membership | `{attributionRole, sectorId, planId, name, phone, phoneIsWhatsapp, email?, observation?, address*, district*, city*, document*, ackVersion*}` (*J3, gap) | `{ok, idempotent, opportunityId}` | — | **sim** | `create_employee_sales_opportunity` (existente; J3 amplia → **futura v2**) |
| `/api/employee/sales` | GET | funcionario | `?period=AAAA-MM&status&stage&commissionStatus&competence&cursor&limit` | `items[{id, createdAt, leadLabel, planName, status, stage, myRole, commissionStatus, competence, updatedAt}]` | sim | — | **futura** `employee_list_own_sales` (security definer, filtra `auth.uid()`) |
| `/api/employee/sales/[id]` | GET | funcionario (dono da atribuição) | id opaco | `{header, timeline[], allowedData, commercial, conversionEvidence:{invoiceGenerated:'proven'\|'not_proven', invoicePaid:'proven'\|'not_proven'}, myCommission?, adjustments[]}` | — | — | **futura** `employee_get_own_sale` |
| `/api/employee/compensation` | GET | funcionario | `?cursor` | `items[{competence, status, netTotal?}]` (`netTotal` só se houver componente visível) | sim | — | **futura** `employee_list_own_competences` |
| `/api/employee/compensation/[competence]` | GET | funcionario | `AAAA-MM` | `{competence, period, status, visibleComponents[], lines[{type, label, quantity?, unitAmount?, amount, status, reasonSummary?}], totals:{expected?, closed?}}`. Componentes não visíveis **omitidos** | — | — | **futura** `employee_get_own_competence` (usa `employee_compensation_visible_components`) |

## Admin (`admin_master | admin_financeiro`; `admin_consulta` → 403)

| Endpoint | Método | Input principal | RPC |
|---|---|---|---|
| `/api/admin/remuneracao/regras` | GET | filtros + cursor | **futura** `finance_list_commission_rules` |
| `/api/admin/remuneracao/regras` | POST | `{sectorId?, attributionRole?, method, fixedAmount?, percentageRate?, percentageBase?, effectiveFrom, effectiveUntil?}` + Idempotency-Key | `create_commission_rule_draft` (existente) |
| `/api/admin/remuneracao/regras/[id]/versoes` | POST | campos alteráveis + Idempotency-Key | `version_commission_rule_draft` (existente) |
| `/api/admin/remuneracao/regras/[id]/aprovar` | POST | motivo | **futura**, bloqueada até J10 (`financial_rules_inactive`) |
| `/api/admin/remuneracao/perfis?employeeId=` | GET | — | **futura** `finance_list_compensation_profiles` |
| `/api/admin/remuneracao/perfis` | POST | `{employeeId, validFrom, validUntil?, salary?, meal?, transport?, fuel?, show*}` + Idempotency-Key + `confirmed:true` | `configure_employee_compensation_draft` (existente) |
| `/api/admin/remuneracao/dias?month=&employeeId=` | GET | — | **futura** `finance_list_worked_days` |
| `/api/admin/remuneracao/dias` | PUT | `{employeeId, workDate, status, mealEligible}` + Idempotency-Key (= `operation_id`) | `record_employee_worked_day` (existente) |
| `/api/admin/remuneracao/dias/lote` | POST | `{items[≤ 62], confirmCount}` | N × `record_employee_worked_day` (por item; resultado por item) |
| `/api/admin/remuneracao/competencias` | GET / POST | GET filtros; POST `{employeeId, competenceMonth}` | **futura** list / `open_payroll_competence_draft` (existente) |
| `/api/admin/remuneracao/competencias/[id]` | GET | — | **futura** `finance_get_competence` |
| `/api/admin/remuneracao/competencias/[id]/{calcular,revisar,fechar,pagamento,reabrir}` | POST | confirmação reforçada + motivo | **futuras**; fechar/pagar bloqueadas até J10 |
| `/api/admin/remuneracao/competencias/[id]/ajustes` | POST | `{lineType: adjustment\|other_earning\|discount, amount, description, reason}` | `add_manual_payroll_adjustment` (existente) |
| `/api/admin/remuneracao/atribuicoes` | POST | `{opportunityId, employeeId, attributionRole, sectorId}` | `attribute_employee_sales_opportunity` (existente) |
| `/api/admin/remuneracao/auditoria` | GET | `?entity&from&to&actor&cursor` | **futura** `finance_list_audit_events` (sanitizada; `before/after_safe` só com chaves da allow-list) |

Saída admin de listas: sem telefone ou documento do cliente; nomes de
funcionários permitidos para admins.
