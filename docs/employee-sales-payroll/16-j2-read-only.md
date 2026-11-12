# 16 — Sprint 3.1F-J2: navegação do funcionário, leitura própria e guards financeiros

Fase: 3B_READ_ONLY_IMPLEMENTATION. Base: J1 (`a36593e`). Nenhuma regra ativada,
nenhum dado financeiro criado, nenhum formulário funcional, nenhum ERP/Sync/probe.

## 1. Rotas entregues

| Rota | Tipo | Observação |
| --- | --- | --- |
| `/funcionario` | leitura | Cards do mês (zeros reais) + bloco "Operação" pré-existente |
| `/funcionario/vendas` | leitura | Lista própria, filtros (formulário de **consulta GET**), paginação server-side |
| `/funcionario/vendas/[id]` | leitura | 404 idêntico para "não existe" e "não é seu" |
| `/funcionario/remuneracao` | leitura | Perfil vigente (somente componentes visíveis) + competências |
| `/funcionario/remuneracao/[competencia]` | leitura | `YYYY-MM`; competência inexistente = estado vazio (nada é criado) |
| `/funcionario/nova-oportunidade` | **não criada** | Aviso "Nova oportunidade: em breve" no início; sem formulário/POST |
| `/admin/remuneracao` + `regras`, `funcionarios`, `dias-trabalhados`, `competencias`, `auditoria` | shells | "Nenhuma configuração criada"; sem formulário/botões de ação; não leem tabelas financeiras |

## 2. RPCs de leitura (migration `supabase/patch-employee-read-rpcs-3-1f-j2.sql`)

Públicas para `authenticated` (EXECUTE revogado de PUBLIC/anon/service_role):

- `employee_sales_dashboard_summary(p_month date)`
- `list_employee_sales(p_limit 1..50, p_offset 0..10000, p_sort created_desc|created_asc|updated_desc, p_from, p_to, p_stage, p_status, p_commission)`
- `get_employee_sale_detail(p_opportunity_id uuid)`
- `employee_compensation_summary(p_limit 1..24, p_offset)`
- `list_employee_competence_lines(p_competence_month date)`

Helpers internos sem EXECUTE para nenhum papel cliente: `employee_portal_self`,
`employee_portal_mask_name`, `employee_portal_line_visible`, `employee_portal_line_kind`.

Garantias: `SECURITY DEFINER` + `search_path = public, pg_temp`; `STABLE`; sem SQL
dinâmico; sem escrita; nenhum parâmetro de identidade — o funcionário é resolvido por
`auth.uid()`; retorno jsonb mínimo. Erros estáveis: `employee_portal_unauthenticated`,
`employee_portal_forbidden`, `employee_portal_not_found`, `employee_portal_invalid_parameter`.

Aplicação: **não aplicada remotamente nesta sprint**. Ordem futura (release separado):
`preflight-…sql` (somente leitura) → `patch-…sql` → `verify-…sql` (todas as linhas `ok=true`).
Rollback: `rollback-employee-read-rpcs-3-1f-j2.sql` remove somente as 9 funções novas.

## 3. APIs (somente GET, `Cache-Control: no-store`, `Vary: Cookie`)

`/api/employee/dashboard`, `/api/employee/sales`, `/api/employee/sales/[id]`,
`/api/employee/compensation`, `/api/employee/compensation/[competence]`,
`/api/admin/remuneracao` (estrutura apenas, guard Admin Master/Financeiro).

- Sessão do próprio usuário (JWT encaminhado); nunca service role.
- Query validada por allowlist; parâmetros de identidade (`employee_id`, `profile_id`, `user_id`, `uid`…) → 400.
- Contratos fechados (`lib/employee-portal/contracts.ts`): chaves extras são descartadas.
- 401 sem sessão, 403 papel sem acesso, 404 sem revelar existência, 400 inválido, 503 indisponível.
- **Ordem obrigatória (3.1F-J2B, `lib/employee-portal/api-gate.ts`):** 1) sessão → 2) usuário →
  3) papel `funcionario` + perfil ativo + vínculo `employees` em active/paused/vacation/away
  (leitura da PRÓPRIA linha via sessão/RLS; mesma política da RPC) → 4) validação de path/query →
  5) RPC. Anônimo recebe 401 e papel/vínculo recusado recebe 403 mesmo com parâmetro inválido,
  sem mensagem de validação e sem chamar RPC. Autorizado com parâmetro inválido (inclusive UUID
  ou competência malformados) recebe 400 sem chamar RPC; registro próprio inexistente ou de
  terceiro recebe o mesmo 404.
- Logs: somente nome da função e código do erro (sem PII, sem valores).

## 4. Política de status do funcionário

| Status | Acesso |
| --- | --- |
| ativo | leitura própria |
| pausado / férias / afastado | leitura própria (`readOnly=true`); nenhuma escrita existe nesta fase |
| desligado | bloqueado (403); histórico permanece para Admin/Financeiro; nada é excluído |
| sem vínculo `employees` / perfil inativo | bloqueado (403) |

## 5. Privacidade

- Componentes ocultos/desabilitados são **omitidos** do JSON (nunca `0`).
- Comissão sempre presente na competência (0 se não houver); salário/vale/transporte/combustível só se habilitados e visíveis.
- Interessado mascarado (primeiro nome + inicial). Sem telefone, documento, contract_pk, invoice_pk, notas internas ou payload ERP.
- Valores só aparecem para direitos com status ≥ "Em apuração".

## 6. Guards e menu

- `/admin/remuneracao/*` e `/api/admin/remuneracao/*`: somente `admin_master` e `admin_financeiro`
  (regra em `lib/auth/auth-audit.ts` antes da regra genérica `/admin`, guard server-side no layout,
  em cada página e no route handler). `admin_consulta`, comercial, indicador, funcionário e anônimo: negados.
  Ser gestor não concede acesso financeiro.
- Menu: `/admin/financeiro` passa a se chamar **"Financeiro — Indique e Ganhe"** (rota/comportamento inalterados).
  "Remuneração de Funcionários" no grupo Equipe, visível só para master/financeiro.
  Funcionário: Início, Minhas vendas, Minha remuneração.

## 7. Terminologia

Mapa contextual em `lib/employee-portal/terminology.ts`; o `StatusBadge` global do
Indique e Ganhe **não foi alterado**. accrued → "Em apuração", approved → "Revisada",
included_in_payroll → "Incluída na competência", paid → "Pagamento registrado".
Proibidos na área do funcionário: "Saldo disponível", "Solicitar saque", "Sacar", "Carteira", "Chave Pix".

## 8. Diagnóstico das telas em "Carregando…" (seção K) — não corrigido

Telas: `/admin/comerciais`, `/admin/indicacoes`, `/admin/funcionarios` (arquivos não alterados pelo J2).

- Lab local (Supabase simulado): as três estabilizam em ~1 s; nenhum "Carregando…" persistente.
- Análise estática: as três carregam no cliente (`useEffect`) e só desligam o estado de carregamento
  no caminho feliz — **não há `try/finally`**. Se a chamada lançar exceção (rede, sessão expirada,
  erro de parsing), a tela fica em "Carregando…" indefinidamente. Defeito latente pré-existente (fce7f5d).
- Classificação atual: **INCONCLUSIVE** (provável TRANSIENT_CAPTURE_DELAY nas capturas, com risco
  PREEXISTING_RUNTIME_BUG latente). Confirmação depende de verificação ao vivo: status HTTP das APIs,
  console, sessão, tempo de resposta e comparação com fce7f5d.
- Tarefa separada proposta: "3.1F-K1 — loading resiliente (try/finally + estado de erro) nas telas admin legadas".

## 9. Testes

- `node --import ./scripts/local-pg-collections-lab/alias-register.mjs --experimental-strip-types --test lib/employee-portal/*.test.ts lib/admin-remuneracao/*.test.ts`
- `node scripts/j2-employee-read-rpcs-lab.mjs` (PostgreSQL de lab; inclui rollback/reaplicação e zero-write)
- `node scripts/j2-local-e2e/run.mjs` (build local apontando para Supabase simulado em 127.0.0.1; screenshots 360×800, 390×844, 1366×768)
