# 15 — Plano de implementação da Fase 3 (seção O)

Cada slice é uma sprint com **commit local → revisão → release controlado**,
seguindo o padrão da 3.1F:
- lab Postgres local;
- preflight remoto READ ONLY;
- uma única aplicação de migration;
- validação de catálogo;
- push fast-forward.

`READY_FOR_ACTIVE_FINANCIAL_RULES` continua **NO** até J10.

## Gaps de schema encontrados (frente à fundação liberada)

| # | Gap | Slice |
|---|---|---|
| G1 | `create_employee_sales_opportunity` não recebe endereço/bairro/cidade/documento/versão de ciência | J3 |
| G2 | A mesma RPC não valida papel × setor (`attribute_*` valida) | J3 |
| G3 | Sem detecção de duplicidade por telefone/documento para origem `employee` | J3 |
| G4 | A RPC H1 usa `search_path = public` sem `pg_temp` | J3 |
| G5 | Tabelas novas sem SELECT para `authenticated` → leituras exigem RPCs security definer "own data" e "finance list" | J2/J4/J5/J7 |
| G6 | Não há RPC de responsável interno indicado pelo próprio funcionário (só admin atribui) | J3 (decisão Q1) |
| G7 | `payroll_competences` sem trigger de transição de status | J7 |
| G8 | Reabertura: `closed/paid` imutáveis → precisa de RPC de nova versão (`reopened`) | J7/J10 |
| G9 | Dia trabalhado alterável com competência `reviewed` (o banco só bloqueia closed/paid) | J6 |
| G10 | Perfil sem colunas para "outros componentes" e sem `show_*` para outros ganhos/descontos | J5 (decisão Q4) |
| G11 | Transporte/combustível sem tipo "reembolso" (só `per_worked_day`/`monthly_fixed`) | futuro (via ajuste) |
| G12 | Sem RPC de aprovação de regra/perfil, nem CHECK `approved_by ≠ created_by` | J5 (aprovação ativa só em J10) |
| G13 | Sem RPCs calcular/revisar/fechar/pagar competência | J7 (draft/read-only), J10 (fechar/pagar) |
| G14 | Guarda de rota: `admin_consulta` herda `/admin/*` | J2/J5 |
| G15 | `StatusBadge` mapeia "Paga"/"Disponível" (Indique e Ganhe) | J2 (mapa próprio) |

## Slices

### J2 — Leitura e navegação do funcionário
- **Migrations:** RPCs de leitura `employee_list_own_sales` e `employee_get_own_sale` (security definer, `auth.uid()`, sanitizadas, EXECUTE só `authenticated`).
- **Código:**
  - novo painel `/funcionario` (cards comerciais + Operação preservada);
  - itens no `funcionarioNav`;
  - mapa de status próprio;
  - guarda de rota `/admin/remuneracao/*` (deny `admin_consulta`), mesmo antes de existirem as páginas.
- **Testes:** arquitetura (sem service_role, sem textos proibidos, sem "saldo"); lab PG das RPCs (dono vê, outro funcionário não vê, admin não usa essa RPC); unit de sanitização.
- **Dependências:** fundação I3. **Gates:** TSC/build/bundle scan; snapshot zero de dados financeiros.
- **Rollback:** redeploy do SHA anterior; as RPCs de leitura podem ficar.
- **Risco:** baixo (somente leitura). **Desativado:** remuneração e criação de oportunidade.

### J3 — Criação segura de oportunidade
- **Migrations:** `create_employee_sales_opportunity` v2 (G1–G4, G6 conforme Q1) com assinatura nova; a antiga fica revogada ou mantida por compatibilidade.
- **Código:** formulário e endpoint POST com idempotência e mensagens do doc 04.
- **Testes:**
  - lab: duplicidade, papel × setor, inativo, idempotência, concorrência;
  - garantia de 0 reward/wallet;
  - arquitetura do endpoint (JWT do usuário).
- **Dependências:** J2. **Gates:** preflight remoto; release controlado; smoke sem mutação real (no máximo uma oportunidade de teste, se autorizada).
- **Rollback:** ocultar o item de menu por flag de rota; a RPC fica (append-only).
- **Risco:** médio (escrita em `referrals`). **Desativado:** comissão, ERP automático.

### J4 — Vendas e acompanhamento
- **Migrations:** nenhuma, ou RPC de timeline sanitizada.
- **Código:** `/funcionario/vendas`, detalhe, `/admin/funcionarios/[id]/vendas`, `/funcionario/equipe` (Gestor, sem valores).
- **Testes:** visibilidade (dono, gestor, outro funcionário, admin_consulta); paginação keyset.
- **Gates/rollback:** padrão. **Risco:** baixo. **Desativado:** blocos de comissão (mostram "Regras não ativas").

### J5 — Drafts de regras e remuneração (Admin)
- **Migrations:**
  - RPCs `finance_list_*`;
  - RPCs de aprovação **sem** ativação (G12), com CHECK de segregação;
  - colunas de "outros componentes" e flags de visibilidade, se Q4 aprovar.
- **Código:**
  - `/admin/remuneracao/regras` (modelos visuais R$30/R$50/2%/R$22, Ativar desabilitado);
  - `/admin/funcionarios/[id]/remuneracao`;
  - `/admin/remuneracao/beneficios`.
- **Testes:** só drafts; percentual e primeira fatura desabilitados; nenhum default inserido; segregação; deny para `admin_consulta`.
- **Gates:** zero regra ativa; zero perfil ativo. **Rollback:** ocultar rotas; drafts ficam (imutáveis).
- **Risco:** médio. **Desativado:** ativação de regra e de perfil.

### J6 — Dias trabalhados
- **Migrations:** guarda "reviewed → exige ajuste" (G9); RPC `finance_list_worked_days`.
- **Código:** grade mensal, lote com confirmação, cópia apenas visual.
- **Testes:** idempotência por `operation_id`; vale só em `worked`; bloqueio após closed/paid; lote parcial com resultado por item.
- **Risco:** médio. **Desativado:** cálculo de vale na competência.

### J7 — Competência em modo draft/read-only
- **Migrations:** trigger de transição (G7); RPC de cálculo **em modo pré-visualização** (sem gravar linhas de comissão); RPC de nova versão (G8) sem `closed/paid`.
- **Código:** lista e detalhe da competência, divergências, ajustes manuais; `/funcionario/remuneracao` em modo leitura.
- **Testes:** totais = soma das linhas; arredondamento de meio centavo; componentes não visíveis omitidos na RPC do funcionário.
- **Risco:** médio-alto. **Desativado:** fechar, pagar, comissão automática.

### J8 — Painéis e auditoria
- **Migrations:** `finance_list_audit_events` sanitizada.
- **Código:** `/admin/remuneracao/auditoria`, `/admin/remuneracao/comissoes` (visão de direitos — vazia até J10), cards completos do painel do funcionário.
- **Testes:** allow-list de chaves; nenhuma PII; deny para `admin_consulta`. **Risco:** baixo.

### J9 — Homologação completa
- **Migrations:** nenhuma.
- **Código:** correções de UX.
- **Testes:** roteiro ponta a ponta em staging/lab com dados sintéticos; acessibilidade; mobile 390px; carga de listas.
- **Gate:** aceite do produto + revisão de segurança. **Desativado:** tudo o que é financeiro ativo.

### J10 — Ativação somente após evidência ERP
- **Pré-requisitos:** `ERP_FIRST_INVOICE_ORDER_PROVEN=YES`, `ERP_PAID_AMOUNT_PROVEN=YES` (para percentual/primeira fatura), `COMMISSION_AUTOMATION_ALLOWED=YES` e autorização explícita.
- **Migrations:**
  - remover `*_foundation_inactive_chk` e `payroll_competences_foundation_no_close_pay_chk`;
  - abrir o portão `financial_rules_inactive`;
  - RPCs de avaliação de evidência, fechar e pagar.
- **Testes:** idempotência de direitos; estornos; concorrência; reconciliação com o ERP.
- **Rollback:** reinstalar os CHECKs (com tabelas sem violação) e desligar o avaliador; **sem DROP**.
- **Risco:** alto.
