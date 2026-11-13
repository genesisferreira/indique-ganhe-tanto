# Sprint 3.1F-J3 — Oportunidade de venda do funcionário (ponta a ponta)

## Escopo
Técnico (`technician_originator`) ou Vendas Externas (`external_sales_originator`) registra um cliente interessado em
`/funcionario/nova-oportunidade`. A oportunidade entra no MESMO pipeline do Indique e Ganhe (`public.referrals`,
`pipeline_stage = 'novo'`, `status = 'pendente'`) com `origin_kind = 'employee'`, `reward_eligible = false`,
`indicator_profile_id = null`, e atribuição imutável em `sales_opportunity_attributions`. Acompanhamento em
"Minhas vendas". Zero recompensa/carteira/saque/direito de comissão; comissão segue inativa (Entrega B). Sem ERP/Sync.

## Banco — `supabase/patch-employee-sales-opportunity-3-1f-j3.sql` (aditiva, transacional, re-executável)
| Objeto | Tipo | Execução |
|---|---|---|
| `employee_opportunity_normalize_phone(text)` | SQL imutável (mesmo algoritmo do TS) | public (necessário ao índice) |
| `referrals_phone_norm_idx` | índice de expressão (duplicidade por telefone normalizado) | — |
| `employee_opportunity_eligible_roles(uuid)` | SECURITY DEFINER interno | nenhum papel |
| `employee_opportunity_form_context()` | SECURITY DEFINER, `search_path = public, pg_temp` | authenticated |
| `submit_employee_sales_opportunity(jsonb)` | SECURITY DEFINER, atômica | authenticated |
| `list_employee_sales_filtered(...)` | leitura (J2 + papel + busca) | authenticated |
| `list_employee_opportunity_origins(uuid[])` | leitura (admin: todas; comercial: próprios leads) | authenticated |
| `create_employee_sales_opportunity` (H1) | preservada; EXECUTE revogado de clientes (papel era escolhido pelo cliente) | nenhum cliente |

Ordem do submit: sessão (`auth.uid()`) → perfil funcionário ativo + registro de funcionário → status `active` →
chaves allowlisted → normalização/validação → consentimento → plano ativo → papel derivado dos vínculos reais
(escolha obrigatória só com 2 papéis; incompatível = recusa) → locks de transação (chave, telefone, documento) →
idempotência (mesma chave+payload = original; payload diferente = conflito) → duplicidade (aberta = bloqueio;
encerrada < 90 dias = aviso + confirmação explícita) → insert com origem funcionário → atribuição imutável →
auditoria sanitizada → JSON fechado. Sem SQL dinâmico; nunca toca tabelas financeiras.

**Plano de interesse:** `referrals.plan_id` é NOT NULL; o formulário exige o plano (somente planos ativos).

## App
- `POST /api/employee/opportunities` (`lib/employee-opportunities/handlers.ts`): sessão → gate (próprio profile/employee)
  → Origin = Host/X-Forwarded-Host → `application/json` ≤ 8 KB → validação estrita → UMA RPC. Logs só com classe/código.
- Formulário (`components/employee-opportunities/opportunity-form.tsx`): máscaras, validação local compartilhada,
  chave de idempotência por abertura, trava de duplo clique, erro mantém dados, sucesso limpa e mostra protocolo.
- "Minhas vendas": filtros de papel e busca (protocolo, nome mascarado, plano); comissão "Aguardando regra financeira".
- Painel: atalho real "Nova oportunidade"; cartões reais; comissão "Não calculada" enquanto não houver regra.
- Pipeline (admin/comercial): selo "Técnico"/"Vendedor externo" + funcionário originador via RPC autorizada.
- Navegação: "Nova oportunidade" só com vínculo de setor `technician`/`external_sales` (servidor revalida).

## Testes
- `scripts/j3-employee-opportunity-lab.mjs` — PostgreSQL local, cadeia real + J3 (123 verificações).
- `scripts/j3-local-visual.mjs` — Next build + Supabase simulado (somente leitura) + Edge headless (360/390/1366).
- `lib/employee-opportunities/*.test.ts` — contrato, handler (ordem/autorização/CSRF/logs) e arquitetura/migração.

## Pendências
- Homologação real com conta de funcionário Técnico/Vendas Externas (smoke de navegador pelo usuário).
- Entrega B: regras de comissão (inativas) configuradas por Admin/Financeiro.
