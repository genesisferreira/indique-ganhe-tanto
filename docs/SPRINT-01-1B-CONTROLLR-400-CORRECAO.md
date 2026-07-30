# Sprint 1.1B — Correção controlada HTTP 400 Controllr (`client_date_birth`)

**Branch:** `feature/sprint-01-controllr-400-diagnostics`  
**Data:** 2026-07-30  
**Escopo:** confirmação de evidências + correção mínima do formato de nascimento no payload Controllr. Sem commit/merge/deploy nesta etapa.

Relacionado: [Sprint 1.1A — Diagnóstico](./SPRINT-01-1A-CONTROLLR-400-DIAGNOSTICS.md)

---

## 1. Causa — classificação

**Correção candidata com alta confiança, aguardando homologação.**

Não declarar o HTTP 400 como definitivamente resolvido até homologação controlada.

**Nível da hipótese de causa:** altamente provável (não confirmada por mensagem textual do Controllr nesta máquina).

Ainda podem existir **outras causas** de HTTP 400, incluindo:

- `plan_pk` inválido ou ausente;
- `lead_pk` inválido ou ausente;
- campos obrigatórios omitidos/vazios;
- valores inválidos em outros campos;
- mudanças no contrato da API do Controllr.

### Evidências disponíveis

| Fonte | Achado | PII |
|-------|--------|-----|
| Código `buildCreateInterestForm` (pré-1.1B) | Enviava `referred_birth_date` cru (ISO `YYYY-MM-DD`) em `client_date_birth` | não |
| `formatControllrBirthDate` | Já convertia para `DD/MM/YYYY` em observação/UI, **não** no form create | não |
| Transcript histórico do projeto | HTTP 400 **confirmado** anterior: `interest_obs Invalid Value Size \| … \| Max:255` (causa distinta, já mitigada com truncate) | mensagem de sistema |
| Ambiente local | Sem `BRBYTE_API_*` no `.env.local`; sem chamada real ao ERP | — |
| Produção / sync runs | **Pendente de confirmação** — não consultado nesta sprint (risco de dados reais) | — |

### O que falta para “causa confirmada”

Uma amostra sanitizada de produção com:

- `brbyte_last_http_status = 400`
- endpoint `.../client_interest/create`
- `responseMessageHint` ou message do ERP mencionando data / `client_date_birth` / formato

---

## 2. Correção aplicada

**Somente no payload Controllr**, no momento de montar o form:

| Camada | Formato |
|--------|---------|
| Banco / domínio CRM (`referred_birth_date`) | **inalterado** — ISO `YYYY-MM-DD` |
| UI / validação interna | **inalterada** |
| Payload `client_date_birth` | **`DD/MM/YYYY`** via `resolveControllrClientDateBirthForPayload` → `formatControllrBirthDate` |

### Arquivos / funções

| Arquivo | Função / mudança |
|---------|------------------|
| `lib/brbyte/normalize-controllr-text.ts` | `resolveControllrClientDateBirthForPayload`, `buildControllrClientDateBirthField` |
| `lib/brbyte/create-interest.service.ts` | `buildCreateInterestForm` usa o helper; log sanitizado se inválida |
| `lib/brbyte/http-error-diagnostics.ts` | redaction de datas ISO/BR; texto de risco atualizado (regressão) |
| `lib/brbyte/client-date-birth-payload.test.ts` | testes 1.1B |
| `package.json` | inclui o novo arquivo em `test:brbyte` |

### Casos tratados

| Entrada | Resultado no payload |
|---------|----------------------|
| `1990-05-21` | `21/05/1990` |
| `2020-01-09` | `09/01/2020` |
| já `DD/MM/YYYY` válido | pass-through |
| `""` / `null` / `undefined` | campo **omitido** (sem default inventado) |
| inválida | campo **omitido** + warn sanitizado (`client_date_birth_invalid`) |

---

## 3. Campos vazios (Etapa 4 — sem alteração)

Comportamento de `brbyteAdminPostForm` **mantido**: `value === ""` → não envia a chave.

| Campo | Vazio hoje | Evidência Controllr de rejeição | Ação 1.1B |
|-------|------------|----------------------------------|-----------|
| `interest_email_addr` | omitido | não comprovada | manter |
| `interest_addr_*` vazios | omitidos | não comprovada | manter |
| `interest_addr_obs` | omitido se vazio | não comprovada | manter |
| `interest_doc2` (RG) | omitido se vazio | não comprovada | manter |
| `client_date_birth` | omitido se ausente/inválido | parcialmente alinhado à hipótese de data | só formatação quando presente |
| `lead_pk`, `plan_pk`, `interest_status` | vindos da config | obrigatórios de configuração | sem mudança |

Obrigatoriedade oficial Controllr: **pendente de confirmação** (documentação ERP / amostra).

---

## 4. ESLint / lint

| Verificação | Resultado |
|-------------|-----------|
| Script `package.json` → `"lint": "eslint ."` | presente |
| `eslint` em `dependencies` / `devDependencies` | **ausente** |
| `node_modules/eslint` | **ausente** |
| Lockfile | `pnpm-lock.yaml` presente; **sem** `package-lock.json` |
| Config `.eslintrc` / `eslint.config.*` | **não encontrado** |
| `npm run typecheck` / `format:check` | **não existem** no `package.json` |

**Causa do erro `'eslint' não é reconhecido`:** o binário não está instalado porque o pacote **não está declarado** no projeto (não é só `node_modules` incompleto).

**Não feito nesta sprint:** adicionar `eslint` automaticamente (impacto/versão Next 16 a avaliar em sprint separada).

**Proposta (sprint futura):** decidir entre `eslint` + `eslint-config-next` alinhado ao Next 16, ou trocar o script `lint` por `next lint` após config; instalar via `pnpm install` (padrão do lockfile).

---

## 5. Gates

| Gate | Resultado |
|------|-----------|
| `npm run typecheck` | **N/A** — script inexistente |
| `npx tsc --noEmit` | **OK** |
| `npm run test:brbyte` | **OK** (72 pass / 0 fail) |
| `npm run lint` | **FALHOU** — `eslint` não declarado no `package.json` e ausente em `node_modules` |
| `npm run build` | **OK** (executado nesta sprint) |
| `format:check` | **N/A** — script inexistente |

Comando sugerido (sprint futura, não executado aqui): avaliar `pnpm add -D eslint eslint-config-next` + config, ou alinhar script a `next lint`.

---

## 6. Roteiro de homologação (não executar em produção)

1. Ambiente **separado** (Preview/homolog) com banco fictício — **nunca** produção.
2. Credenciais Controllr de **homolog/demo**, se existirem; senão, abortar escrita no ERP.
3. Criar **uma** indicação de teste com nascimento `1990-05-21`.
4. Disparar create interest (admin ou fluxo controlado).
5. Verificar diagnóstico sanitizado: `client_date_birth` presente, risco `birth_date_iso_not_br` **ausente**.
6. Confirmar resposta Controllr ≠ 400 por data (ou message sanitizada).
7. Confirmar **um único** interessado criado (idempotência / sem retry duplicado).
8. Revisar `brbyte_sync_runs` / histórico: sem CPF/e-mail/cookie nos logs novos de HTTP.
9. Confirmar `referred_birth_date` no banco ainda ISO.
10. Mensagem ao usuário coerente (sucesso ou erro amigável).

---

## 7. Plano de rollback

1. Reverter o trecho em `buildCreateInterestForm` que usa `buildControllrClientDateBirthField` para o spread ISO anterior **ou** revert do commit da 1.1B.
2. Manter helpers novos é inofensivo se não usados; remoção opcional.
3. Sem migration → sem rollback de banco.
4. Redeploy da revisão anterior.

---

## 8. Pendências

1. Amostra sanitizada de produção confirmando message do 400.
2. Lista oficial de campos obrigatórios Controllr.
3. ESLint declarado/configurado.
4. Homologação controlada pós-commit.
5. Avaliar se HTTP 400 remanescente (outros campos) após a correção de data.

---

## 9. Riscos residuais

- **Correção candidata com alta confiança, aguardando homologação** — não tratar como problema definitivamente resolvido.
- Outros 400 podem permanecer (`plan_pk`, `lead_pk`, campos obrigatórios, valores inválidos, contrato da API Controllr).
- `.env.local` com Supabase cloud: risco de apontar a dados reais se `DATA_PROVIDER=supabase`.
- `meta.request` histórico ainda pode conter form completo (pré-existente).
