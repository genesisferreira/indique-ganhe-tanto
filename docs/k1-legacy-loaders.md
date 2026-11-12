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
