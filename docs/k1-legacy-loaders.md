# 3.1F-K1 — Loaders legados resilientes e remoção de tendências falsas

Base: `b9055891f1c1e0903d76a2062577094affe7d04c`. Sem migration, sem RLS, sem ERP/Sync,
sem alteração no portal J2, ledger, rewards, wallet ou Collections.

## 1. Modelo de estado (`lib/client/guarded-loader.ts`)

`idle → loading → success | empty | error | timeout`

| Regra | Implementação |
|---|---|
| `empty` só com resposta válida vazia | `listOutcome` / `employeesOutcome`: `null`, não-array, item inválido ⇒ `error invalid_response` |
| erro/timeout nunca viram `[]` | loaders retornam resultado discriminado; a UI renderiza `LoaderStatus` |
| loading sempre termina | `try/catch/finally`; `finally` limpa o timer; abort/timeout competem com o `load` (`Promise.race`) |
| resposta antiga não sobrescreve | sequência + `AbortController`; troca de filtros cria novo controlador e descarta o anterior |
| desmontagem | `dispose()` aborta e bloqueia qualquer emissão de estado |
| refresh não duplica | chamadas durante um carregamento são coalescidas (no máximo 1 pendente) |
| sem retry automático | nova tentativa só por ação do usuário ("Tentar novamente"/"Atualizar"); sem `setInterval` |
| StrictMode | início adiado para microtask: montar→desmontar→montar chama `load` 1× |

**Timeout:** `LEGACY_LOADER_TIMEOUT_MS = 15 000 ms` (centralizado). No lab as três telas estabilizam
em ~1 s; 15 s cobre picos sem esconder lentidão. Timeout é um estado próprio (`timeout`), distinto de
erro HTTP, com mensagem amigável e botão manual.

Mensagens ao usuário são fixas por classe (`unauthenticated`, `forbidden`, `server_error`,
`invalid_response`, `network`, `unexpected`); o texto original do erro nunca é exibido.
Acessibilidade: loading/vazio com `role="status"` + `aria-live="polite"`; erro/timeout com `role="alert"`.

## 2. `/admin/comerciais` — causa do vazio falso

`loadAdminComerciaisFromSupabase()` devolvia `null` para **qualquer** falha (sessão ausente,
papel sem acesso, erro em `profiles`, erro em `referrals` das estatísticas, exceção), e a página fazia
`setLista(remote ?? [])` — logo toda falha era exibida como **"Nenhum comercial encontrado"**.
Também não havia `try/finally` (exceção ⇒ "Carregando…" infinito).

Correção: `loadAdminComerciaisResultFromSupabase({ identity?, signal? })` retorna
`{ ok: true, data } | { ok: false, errorClass }`; a função antiga continua existindo (wrapper) para os
demais chamadores. Query, filtros e permissões **inalterados**; RLS não foi tocada (não há prova de
necessidade: no lab, com as policies reais, o comercial ativo aparece ao Admin Master).

## 3. `/admin/indicacoes` — auth.getUser por carregamento

| Medida (lab, cliente simulado) | Antes (b905589) | Depois |
|---|---:|---:|
| `auth.getUser` por carregamento lógico | 3 | 1 |
| consultas por carregamento | 9 | 7 |
| StrictMode (dev) | 6 getUser / 18 consultas | 1 / 7 |
| carga inicial + 10 eventos realtime | 33 getUser / 99 consultas | 2 / 14 (coalescido) |

A identidade é resolvida uma vez (`getAuthProfileBasicsFromSupabase` → `auth.getUser()`, validado
no servidor Auth) e repassada (`identity`) às consultas do mesmo carregamento. Sem `getSession`,
sem cache global, sem armazenamento local, sem compartilhamento entre usuários. RLS continua sendo
a fronteira. Refresh explícito = nova resolução (1 por ação). Falha só na lista de comerciais não
derruba a tela: o submenu mostra "Lista de comerciais indisponível no momento".
Logs com `authUserId/profileId` passaram a ser emitidos somente em `development`.

## 4. `/admin/funcionarios`

Loader com estados explícitos, `AbortController` por filtro (stale guard), validação da resposta
(`lib/admin-legacy/employees-outcome.ts`), retry manual e vazio real diferenciado
("Nenhum funcionário cadastrado." × "Nenhum funcionário corresponde aos filtros.").
Busca com `<label for="funcionarios-busca">` (visualmente oculto), `type="search"`; filtros com
`aria-label`. Falha na lista de setores desativa só o filtro de setor (com aviso e retry).

## 5. Tendências (StatCard)

Removidos os literais: `/admin` (+12%, +5,2%), `/admin/financeiro` (+12,5% e "+8,2% vs mês
anterior" do modo mock), `/admin/relatorios` (+12%, +5,2% do modo mock), `/comercial/desempenho`
(+15%), `/indicador` (+12%). Nenhuma consulta ou cálculo novo; os valores principais reais ficaram.

`StatCard.trend` agora é `StatCardTrend` explícito:
`{ kind: "change", percent }` (comparação real já calculada) ou `{ kind: "no_comparison" }`.
Sem prop ⇒ nada é renderizado. Sinal por `Math.sign`; `NaN/±Infinity` ⇒ nada; texto para leitor de
tela ("Aumento de X% em relação ao período anterior").

## 6. Testes

- `pnpm run test:k1-legacy-loaders` — controlador, validações, loaders reais com Supabase simulado
  (contagem de getUser/consultas, StrictMode, coalescência, erros 401/403/500/null/malformado,
  timeout, fora de ordem, retry), tendências, verificações estáticas de segurança e acessibilidade.
- `pnpm run test:k1-bundle-scan` — varre `.next` por placeholders após o build.
- `node scripts/k1-local-visual/run.mjs` — E2E visual no lab (360×800, 390×844, 1366×768), estados
  induzidos por interceptação CDP no navegador do lab, snapshot zero-write antes/depois.

---

# 3.1F-K1B — Propagação real do AbortSignal e fechamento das evidências

Base: `2aaedd3` (K1). Sem migration, sem RLS, sem alteração de query/filtro/shape de sucesso,
sem service_role no cliente, sem ERP/Sync. App shell (layout/sidebar/notificações) **não** foi tocado (K2).

## 1. Caminho do signal (um AbortController por carregamento)

```
useGuardedLoader            load: (ctx) => loadRef.current(ctx)            (ctx repassado sem alteração)
  → createGuardedLoader     controller = new AbortController()  (único lugar que cria controller)
                            load({ signal: controller.signal })
  → loader da página        lib/admin-legacy/page-loaders.ts  | lib/admin-legacy/indicacoes-loader.ts
  → service                 withAbortSignal(query, signal)  ⇒  postgrest-js .abortSignal(signal)
                            fetchJsonForLoader              ⇒  fetch(url, { signal, cache: "no-store" })
  → rede                    supabase-js/postgrest-js chamam fetch(..., { signal })
```

Consultas com signal (todas as consultas REST dos loaders K1):

| Tela | Consultas |
|---|---|
| /admin/comerciais | perfil do usuário (papel), `profiles` comerciais, `commercial_availability`, `referrals` (estatísticas) |
| /admin/indicacoes | perfil do usuário, `referrals` (lista), `plans`, `profiles` relacionados, + as 3 de comerciais |
| /admin/funcionarios | `fetch /api/admin/employees` e `fetch /api/admin/sectors` |

`withAbortSignal` é usado somente quando há signal; sem signal a consulta é idêntica à anterior.
O signal nasce no loader client-side: nunca vem de URL/entrada do usuário, não é armazenado e não é compartilhado.

### Limitação comprovada: `auth.getUser()`

`@supabase/auth-js@2.105.1` — `GoTrueClient.getUser(jwt?: string)` não aceita `AbortSignal` (o `_request`
interno não recebe signal). Não alteramos o cliente Supabase global (um `fetch` global com signal seria
compartilhado entre carregamentos/usuários). Portanto **o request do Auth não é cancelado**; mitigação:
após o abort, nenhuma consulta adicional é emitida e o resultado é descartado. O teste B1 afirma
explicitamente que `/auth/v1/user` chega ao transporte **sem** signal — não reivindicamos esse cancelamento.

## 2. Semântica do abort

| Motivo (`LoaderAbortReason.kind`) | Origem | Estado emitido |
|---|---|---|
| `timeout` | timer de 15 s chama `controller.abort()` | `timeout` (alerta + "Tentar novamente") |
| `disposed` | desmontagem (`dispose`) | nenhum (sem alerta) |
| `superseded` | retry/refresh manual (`retry`) ou troca de filtros | nenhum para o antigo; o novo segue |

- Retry manual (`retry()`, botões "Tentar novamente"/"Atualizar") aborta o request anterior **antes** de iniciar o próximo.
- Eventos realtime/mutações continuam coalescidos (`reload({ silent: true })`, no máximo 1 pendente).
- Services retornam `{ ok: false, errorClass: "aborted" }` quando cancelados — nunca lista vazia nem sucesso parcial.
- Timer e listener de abort são removidos no `finally`.
- Sem retry automático.

## 3. Testes

- `lib/admin-legacy/k1b-abort.test.ts` — supabase-js **real** com transporte controlado no lugar da rede
  (`controlled-transport.test-helper.ts`): B1 signal idêntico em cada request; B2–B5 timeout ⇒ `signal.aborted`,
  evento abort observado, promise rejeitada (`AbortError`), nada em voo; B6/B10 desmontagem; B7 retry aborta
  antes do próximo request; B8 resposta antiga (biblioteca que ignora abort) não sobrescreve; B9 timeout ≠ vazio;
  B11–B13 timer limpo; B14 10 retries sem acúmulo de listeners/timers/requests; services ⇒ `aborted`.
- `scripts/k1b-mutation-check.mjs` — 10 mutações (signal não anexado, controller não ligado à query,
  signal não repassado em cada camada, abort ignorado/sucesso parcial, timeout tratado como desmontagem,
  desmontagem exibindo erro, listener não removido, retry sem abort). Cada uma deve derrubar a suíte; controle sem mutação passa.
- Visual/E2E (`scripts/k1-local-visual/run.mjs`): no timeout, o request pendurado é cancelado pela página
  (`Network.loadingFailed canceled=true` via CDP) antes de qualquer liberação pelo harness.

## 4. Fixture sintética (lab local)

`scripts/k1-local-visual/rich-fixture.mjs` — somente PostgreSQL de lab (127.0.0.1, descartável):
- `K1_FIXTURE=rich`: 3 comerciais (1 inativo), 2 indicadores, 4 funcionários com status variados, 4 memberships,
  2 planos, 6 indicações em status variados, 2 rewards, 2 wallet_transactions, disponibilidade comercial,
  1 caso mínimo de Collections; tabelas financeiras (comissão/folha/pagamentos) vazias.
- `K1_FIXTURE=empty`: somente Admin Master — vazio real (resposta válida vazia) nas três telas.
- IDs `88888888-…`, nomes "Sintético", e-mails `@lab.invalid`, telefones `00000000000`. Nenhum dado real.
- Snapshot antes/depois: contagem + digest + `max(updated_at)` por tabela, contadores
  `pg_stat_user_tables` (INSERT/UPDATE/DELETE), tentativas de escrita no simulador, RPCs, hosts externos.

## 5. Regressão comparável

Um comando, uma regra de manifest (`scripts/regression/k1b-manifest-run.mjs`):
`node --import ./scripts/local-pg-collections-lab/alias-register.mjs --experimental-strip-types
--experimental-test-module-mocks --test --test-reporter=tap <arquivo>` — um processo por arquivo,
sobre **todo** `*.test.{ts,tsx,mts,cts,mjs,cjs,js}` (exceto node_modules/.next/.git), em archives limpos
do baseline e do candidato. `scripts/regression/k1b-manifest-compare.mjs` aplica o gate (mesmo comando/Node/pnpm/loader,
nenhum arquivo some, falhas do candidato reproduzem no baseline, arquivos alterados não falham, contagem de testes
estável, diferenças só de CRLF classificadas). Números antigos (913/914, 1693/1699) usaram outros conjuntos de arquivos
e não são comparáveis a este manifest.

## 6. K2 — fora do escopo (documentado, não corrigido)

Medido no lab (build de produção, Admin Master), por carregamento de página inteira:

| Página | `auth/v1/user` total | Das telas K1 | Restante (app shell) |
|---|---:|---:|---:|
| /admin/indicacoes | ~25 | 1 | ~24 |
| /admin/comerciais | ~25 | 1 | ~24 |
| /admin/funcionarios | ~24 | 0 (APIs server-side) | ~24 |

Origem provável: layout administrativo, sidebar (badges/contadores), sino de notificações e provedores de sessão,
cada um resolvendo a identidade por conta própria (~22–24 leituras de `profiles` acompanham).
Impacto possível: latência no primeiro carregamento, carga no Auth/PostgREST, risco de rate limit em picos.
K2 será uma sprint separada; K1B não altera layout global, sidebar, notificações nem a arquitetura de sessão do app shell.

## 3.1F-K1S — comerciais/indicações via rota de API (lock de auth do navegador)

**Sintoma (produção, b905589 e 71bb71e):** `/admin/comerciais` terminava em "Não foi possível carregar os dados." (ou
"Carregando…") sem nunca disparar `GET /rest/v1/profiles?role=eq.comercial`; `/admin/indicacoes` ficava travada/sem
lista. `/admin/funcionarios` funcionava.

**Causa raiz (provada):** no navegador, `auth.getUser()` e o `getSession()` interno de cada consulta REST do supabase-js
passam pelo lock de auth (`navigator.locks`, `lock:<storageKey>`, `lockAcquireTimeout` 5 s, auth-js 2.105.1). O app shell
dispara ~33 `getUser` concorrentes por carregamento; cada um segura o lock por um RTT do Auth. O pedido que espera > 5 s
rouba o lock (`steal`) e o detentor recebe `NavigatorLockAcquireTimeoutError` lançado de dentro de `getUser()`. Se a vítima
é o loader da página: comerciais => catch genérico, lista nunca consultada; indicações => `getBasics` nulo, referrals nunca
consultadas. Funcionários carrega por `/api/admin/employees` (servidor; sem lock do navegador).

Evidência: `scripts/k1-local-visual/k1s-latency-repro.mjs` (lab J2 local + mock Auth com latência; 600 ms/getUser =>
comerciais 3/3 erro sem consulta principal, indicações 3/3 erro, funcionários 3/3 OK, exceção não tratada
"…was released because another request stole it") e `lib/admin-legacy/k1s-api-loaders.test.ts`.

**Correção:** `GET /api/admin/comerciais` e `GET /api/admin/indicacoes` executam os MESMOS loaders/services no servidor
com o cliente da sessão do próprio usuário (`lib/supabase/server`, cookies, `getUser` validado, papel em
`ADMIN_PORTAL_READ_ROLES`, RLS inalterada, sem service_role, `request.signal`, `no-store`). As páginas usam
`lib/admin-legacy/api-page-loaders.ts` (fetch com o signal do guarded loader; validação de shape; datas restauradas).
Indicações: a lista de comerciais (opcional) nunca bloqueia a principal — falha => `comerciaisDisponiveis=false`;
pendente 3 s após as indicações => entregue sem ela (mesmo signal; timeout/desmontagem continuam cancelando tudo).
Sem mudança em RLS, migrations, auth, app shell (K2), funcionários ou J2.
