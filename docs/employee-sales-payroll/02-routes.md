# 02 — Mapa de rotas proposto e verificação de conflitos (seção B)

Verificado contra `app/**/page.tsx`, `app/api/**/route.ts`, `middleware.ts`
(`protectedPrefixes`) e `lib/auth/auth-audit.ts#evaluateRouteAccessForRole`
em `fce7f5d`.

## Rotas existentes relevantes

- Funcionário: `/funcionario` ("Operação") e `/funcionario/perfil`.
  O guard exige `role === 'funcionario'`.
- Admin: o guard libera **`admin_consulta | admin_financeiro | admin_master`**
  para todo `/admin/*`. Rotas existentes:
  - `/admin/funcionarios`, `/admin/funcionarios/novo`, `/admin/funcionarios/[id]`
  - `/admin/financeiro`: **Recompensas Indique e Ganhe**
  - `/admin/pagamentos-pendentes`, `/admin/historico-pagamentos`, `/admin/upload-comprovante`
  - `/admin/auditoria`
- API: não existe `/api/employee/*` nem `/api/admin/remuneracao/*`.

## Funcionário — aprovadas sem alteração

| Rota | Conflito? | Observação |
|---|---|---|
| `/funcionario` | reaproveita a página atual | Vira o painel com a seção "Operação" preservada |
| `/funcionario/nova-oportunidade` | não | Nova |
| `/funcionario/vendas` | não | Nova |
| `/funcionario/vendas/[id]` | não | `[id]` = id opaco da oportunidade; nunca `contract_pk`/`invoice_pk` |
| `/funcionario/remuneracao` | não | Nova |
| `/funcionario/remuneracao/[competencia]` | não | `[competencia]` = `AAAA-MM` (ex.: `2027-01`), validado no servidor |
| `/funcionario/equipe` *(opcional, J8)* | não | Gestor (via `manager_employee_id`) vê vendas da equipe **sem valores** |

## Admin — renomeadas

**Conflito encontrado:** as rotas `/admin/financeiro/*` propostas ficariam
dentro do namespace e do breadcrumb da página **Recompensas** do Indique e
Ganhe. Essa página já usa "Comissões" e "Saldo Disponível" para recompensas de
indicador. Não há colisão de arquivo, mas há **conflito semântico** e risco de
reuso de carteira/saque (stop rule P). **Renomeado para `/admin/remuneracao/*`.**

| Proposta original | Rota aprovada | Motivo |
|---|---|---|
| `/admin/funcionarios/[id]/vendas` | `/admin/funcionarios/[id]/vendas` | Sem conflito (só existe `[id]/page.tsx`) |
| `/admin/funcionarios/[id]/remuneracao` | `/admin/funcionarios/[id]/remuneracao` | Sem conflito; guarda financeira (abaixo) |
| `/admin/financeiro/comissoes` | `/admin/remuneracao/comissoes` | Separar das recompensas |
| `/admin/financeiro/regras` | `/admin/remuneracao/regras` | idem |
| `/admin/financeiro/beneficios` | `/admin/remuneracao/beneficios` | idem (catálogo/sugestões de benefícios; perfis individuais ficam no funcionário) |
| `/admin/financeiro/dias-trabalhados` | `/admin/remuneracao/dias-trabalhados` | idem |
| `/admin/financeiro/competencias` | `/admin/remuneracao/competencias` | idem |
| `/admin/financeiro/competencias/[id]` | `/admin/remuneracao/competencias/[id]` | idem |
| `/admin/financeiro/auditoria` | `/admin/remuneracao/auditoria` | `/admin/auditoria` já existe (logs gerais); sem colisão |

API correspondente: `/api/employee/*` e `/api/admin/remuneracao/*` (ver [12](./12-api-contracts.md)).

## Menu proposto

- **Funcionário** (`funcionarioNav`): Início · Nova oportunidade · Minhas vendas ·
  Minha remuneração · Notificações · Operação (Cobrança/Retenção por setor) · Meu perfil.
  "Nova oportunidade" só aparece com membership elegível
  (técnico / vendedor externo / comercial interno).
- **Admin** — novo grupo **REMUNERAÇÃO DA EQUIPE**, separado do grupo
  FINANCEIRO (que passa a se chamar, no rótulo, "Financeiro — Indique e Ganhe"
  em sprint futura): Comissões · Regras · Benefícios · Dias trabalhados ·
  Competências · Auditoria da remuneração. O grupo inteiro fica **oculto para
  `admin_consulta`**.

## Guardas obrigatórias (implementar em J2/J5, não agora)

1. **Middleware/`evaluateRouteAccessForRole`:** antes da regra genérica de
   `/admin`, adicionar:
   - `/admin/remuneracao/*` e `/admin/funcionarios/[id]/remuneracao` → somente
     `admin_master | admin_financeiro`;
   - `admin_consulta` → `allowed:false`.
2. `/admin/funcionarios/[id]/vendas` → `admin_master | admin_financeiro |
   admin_consulta` (sem valores monetários para `admin_consulta`).
3. `/funcionario/*` já exige `funcionario`. Além disso, o servidor valida
   `employees.status='active'` e membership para "Nova oportunidade".
4. Toda página server-side revalida o papel. O middleware de desenvolvimento
   faz bypass (`NODE_ENV=development`), então RLS e RPC continuam sendo a defesa real.
5. Ids nas URLs são opacos. `[competencia]` aceita somente `^\d{4}-(0[1-9]|1[0-2])$`.
