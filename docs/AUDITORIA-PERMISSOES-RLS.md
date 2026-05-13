# Auditoria de permissões (RLS + frontend)

**Data:** 2026-05-12  
**Escopo:** Supabase (`supabase/rls-policies.sql`, RPCs em `supabase/*.sql`), Next.js (`middleware.ts`, layouts, páginas com checagem de role), serviços cliente (`lib/services/supabase-data.service.ts`).

---

## 1. Resumo executivo

| Área                         | Situação |
|-----------------------------|----------|
| RLS em tabelas principais   | Bem alinhada aos papéis (`is_admin_read_any`, `is_admin_write_any`, dono do recurso). |
| RPCs sensíveis              | `mark_first_invoice_paid` e fluxo Pix validam role no servidor (`SECURITY DEFINER`). |
| Middleware Next.js          | **Crítico:** validação por sessão/role está comentada; em `development` há bypass total. Em produção o fluxo ainda cai em `return NextResponse.next()` sem checar usuário. |
| Layouts `/admin`, `/comercial`, `/indicador` | `AuthenticatedDashboardShell` + `getAuthProfileBasicsFromSupabase` (mock apenas com `DATA_PROVIDER=mock`). |
| Log dev `[auth-audit]`      | `DashboardLayout` + `lib/auth/auth-audit.ts`; em `development`, `middleware.ts` também loga ao acessar prefixos protegidos (role `null` no edge — bypass documentado). |

---

## 2. Matriz RLS (referência rápida)

### `referrals`

- **SELECT:** indicador (próprias), comercial (atribuídas + pool `commercial_profile_id IS NULL`), admins leitura global.
- **INSERT:** indicador (`indicator_profile_id = auth.uid()`) ou `admin_master`.
- **UPDATE:** `commercial_profile_id = auth.uid()` **ou** `admin_master` (updates diretos pelo cliente em lead do pool seguem bloqueados; o fluxo **Assumir lead** usa a RPC `claim_referral_lead`, `SECURITY DEFINER`).
- **DELETE:** `admin_master`.

**Claim no pool:** o cliente chama `claim_referral_lead` (`supabase/claim-referral-lead.sql`), que atualiza a linha e grava `referral_history` com privilégios `SECURITY DEFINER`, sem depender da policy de `UPDATE` para `commercial_profile_id` nulo.

### `referral_history`

- **SELECT:** participante (indicador/comercial atribuído) ou admin leitura.
- **INSERT:** `actor_profile_id = auth.uid()` ou `admin_master`.
- **UPDATE/DELETE:** `admin_master`.

### `rewards`

- **SELECT:** indicador (próprio) ou admins leitura.
- **INSERT/UPDATE/DELETE:** `is_admin_write_any()` → `admin_financeiro` e `admin_master` apenas. **`admin_consulta` não altera recompensas** — OK com o requisito.

### `payments`

- **SELECT:** indicador (próprio) ou admins leitura.
- **INSERT/UPDATE:** `is_admin_write_any()`.
- **DELETE:** `admin_master`.

### `wallet_transactions`

- **SELECT:** indicador (próprio) ou admins leitura.
- **INSERT/UPDATE:** `is_admin_write_any()` (comercial **não** lê/escreve carteiras alheias por RLS).
- **DELETE:** `admin_master`.

### `notifications`

- **SELECT:** dono (`profile_id = auth.uid()`) ou admins leitura.
- **INSERT:** `admin_write` **ou** `profile_id = auth.uid()` (notificação para si).
- **UPDATE:** dono ou `admin_write` (financeiro/master podem alterar linhas de terceiros — útil operacionalmente; documentar como poder elevado).
- **DELETE:** `admin_master`.

### `pix_keys`

- **SELECT:** dono ou admins leitura.
- **INSERT/UPDATE/DELETE:** dono; insert/update/delete extra: `admin_master` onde aplicável.

### `profiles`

- **SELECT:** self, admins leitura, ou comercial se existir `referrals` ligando indicador a leads visíveis ao comercial.
- **UPDATE:** self ou `admin_master` (**`admin_financeiro` não altera perfis de terceiros** — alinhado a “não alterar permissões admin”).

### `plans`

- **SELECT:** planos ativos ou admins leitura.
- **WRITE:** `admin_master` apenas.

### Storage `payment-proofs`

- Leitura: indicador no prefixo do path ou admins leitura.
- Escrita: `admin_write` ou indicador no próprio prefixo.

---

## 3. RPCs `SECURITY DEFINER` (trechos relevantes)

| Artefato | Checagem de role |
|----------|------------------|
| `public.current_user_role` e helpers (`is_admin_*`, etc.) | Leem `profiles` com definer — base para policies. |
| `mark_first_invoice_paid` (`first-invoice-paid.sql`) | Apenas `admin_financeiro` \| `admin_master`. |
| `request_pix_withdrawal` (`pix-withdrawal-flow.sql`) | Apenas `indicador`. |
| Aprovar / rejeitar / concluir saque Pix | Apenas `admin_financeiro` \| `admin_master` (`admin_consulta` bloqueado). |
| `wallet_balance_latest` | Definer; uso interno — revisar chamadas para não vazar saldo de terceiros sem checagem na função chamadora. |

---

## 4. Frontend

### Proteção de rotas

- **`middleware.ts`:** não usa `updateSession`; em `development` retorna `next()` para todas as rotas; em produção o bloco Supabase está comentado e o fluxo termina em `NextResponse.next()` — **não há bloqueio por role no edge.**
- **Layouts:** `/admin` e `/comercial` não redirecionam usuário sem perfil; `/indicador` usa `IndicadorHomeProvider` com fallback mock se Supabase falhar (comportamento já existente — risco operacional se sessão inválida).

### Páginas com checagem explícita (amostras)

- **`app/admin/pagamentos-pendentes/page.tsx`:** `podeAgir` só `admin_financeiro` \| `admin_master`; consulta pode ver fila.
- **`app/comercial/leads/[id]/page.tsx`:** “Confirmar primeira mensalidade” só `admin_financeiro` \| `admin_master` (`podeConfirmarPrimeiraMensalidade`).
- **`app/admin/sla/page.tsx`:** exige `admin_master` para ação sensível.

### Sidebar / menu

- Itens por `variant`; não substituem RLS. Contadores vêm do Supabase quando provider ≠ mock (já auditado anteriormente).

### Repositórios

- `supabase-referral.repository.ts`: `assignToComercial` não implementado — fluxo real passa por `supabase-data.service`.

---

## 5. Logs dev `[auth-audit]`

- **`lib/auth/auth-audit.ts`:** `logAuthAudit`, `evaluateRouteAccessForRole`, `evaluateVariantRoleMatch`.
- **`components/auth-route-audit.tsx`:** montado em `DashboardLayout`; em dev loga `role`, `route`, `allowed`, `reason` após `getAuthProfileBasicsFromSupabase()`.
- Rotas `/indicador` e `/comercial` com **role admin** são tratadas como permitidas no **log** (cenário de teste do repositório); produção continua dependendo do RLS.

---

## 6. Endpoints / superfícies sensíveis

- RPCs: `claim_referral_lead` (`claim-referral-lead.sql`), `mark_first_invoice_paid`, `request_pix_withdrawal`, `approve_pix_withdrawal`, `reject_pix_withdrawal`, `complete_pix_withdrawal` (nomes conforme SQL em `supabase/`).
- Qualquer `insert`/`update` direto em `payments`, `rewards`, `wallet_transactions` pelo cliente: deve passar por RLS; ações financeiras preferencialmente via RPC já auditadas.

---

## 7. Permissões consideradas **OK** (alto nível)

- Indicador: leitura/escrita restrita ao próprio eixo (indicações, carteira, pagamentos, pix_keys, notificações) via RLS.
- Comercial: sem acesso a `wallet_transactions` / pagamentos de terceiros por policy; leads visíveis conforme política de `referrals`.
- `admin_consulta`: leitura ampla nas tabelas com `is_admin_read_any`; sem `is_admin_write_any` em mutações financeiras.
- `admin_financeiro`: escrita em recompensas/pagamentos/carteira conforme policies e RPCs Pix / primeira mensalidade.
- `admin_master`: exclusões e writes em `plans`, `profiles` alheios, etc.

---

## 8. Riscos e sugestões

| ID | Severidade | Descrição | Sugestão |
|----|------------|-----------|----------|
| R1 | **Resolvido (app + SQL)** | Claim de lead no pool | Aplicar `supabase/claim-referral-lead.sql` no projeto Supabase; o cliente usa `claim_referral_lead` via `claimComercialLead`. |
| R2 | **Alta** | Middleware não autentica nem redireciona por role. | Habilitar `updateSession` + leitura de `profiles.role` (ou JWT claim) e `redirect` para `/login` ou dashboard correto. |
| R3 | **Média** | Layouts admin/comercial mostram identidade mock no shell quando não há integração. | Após login, preencher nome/role a partir do Supabase (como em `notificacoes/layout`). |
| R4 | **Média** | Páginas admin que ainda listam dados mock (`app/admin/admins/page.tsx`, etc.) não exercitam RLS. | Migrar para loaders Supabase ou ocultar até `DATA_PROVIDER=supabase`. |
| R5 | **Baixa** | `admin_financeiro` pode `UPDATE` notificações de terceiros (policy). | Aceitar como ferramenta interna ou restringir a `admin_master` se necessário. |

---

## 9. Próximos passos recomendados

1. Corrigir RLS ou introduzir RPC para **claim de lead** no pool.  
2. Ativar **middleware** com Supabase e matriz `routePermissions` em todos os ambientes não públicos.  
3. Revisar **todas** as páginas `app/admin/**` para checagem mínima de role alinhada a botões (padrão de `pagamentos-pendentes` e `sla`).  
4. Manter `[auth-audit]` em dev durante a migração e revisar logs com usuários reais por perfil.

---

*Documento gerado como entregável da auditoria solicitada; revisar após alterações em `rls-policies.sql` ou middleware.*
