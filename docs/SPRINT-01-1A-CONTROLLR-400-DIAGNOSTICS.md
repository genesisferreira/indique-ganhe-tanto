# Sprint 1.1A — Diagnóstico HTTP 400 Controllr

**Branch:** `feature/sprint-01-controllr-400-diagnostics`  
**Data:** 2026-07-30  
**Escopo:** somente diagnóstico sanitizado + testes simulados. Sem correção especulativa, sem chamada real ao ERP, sem commit.

---

## 1. Mapa de chamadas Controllr/BRByte (código atual)

| Fluxo | Tela / disparo | Rota CRM | Serviço | Cliente HTTP | Endpoint |
|-------|----------------|----------|---------|--------------|----------|
| Criar Interessado (admin) | Admin → indicação → card Controllr | `POST /api/admin/brbyte/create-interest` | `createBrbyteInterestFromReferral` | `brbyteAdminLogin` + `brbyteAdminPostForm` | `POST /login` → `POST /controllrctl/client_interest/create` |
| Criar Interessado (indicador/auto) | Nova indicação / retry | `POST /api/indicador/referrals/[id]/create-interest` | idem | idem | idem |
| Lookup pós-create | interno após create | — | `lookupClientInterestByDocument` | `brbyteAdminPostForm` | `POST /controllrctl/client_interest/list` |
| Checar conversão | Admin / cron lifecycle | `POST /api/admin/brbyte/check-conversion` + cron | `check-conversion.service` | login + post | `POST /controllrctl/client_interest/list` |
| 1ª fatura | Admin / cron lifecycle | `POST /api/admin/brbyte/check-first-invoice` + cron | `check-first-invoice.service` | login + post | `list` → `/invoice_ctl/invoice/list` → `/invoice_ctl/invoice/list_info` |
| Health | Admin integrações | health helper | `health.ts` | `brbyteAdminLogin` | `POST /login` |
| Sync legado (API key) | cron antigo | `/api/cron/brbyte-sync` (legado em `lib/cron/brbyte.service.ts`) | fetch com API key | paths `/api/...` | **não** usa cookie admin; separado do fluxo Controllr ctl |

**Conclusão de mapeamento:** o HTTP 400 funcional reportado no contexto Indique/Interessado concentra-se no fluxo **create interest** (`/controllrctl/client_interest/create`). List/invoice também podem retornar 400 em formatos de payload tentados em sequência (retry local), mas o fluxo de negócio prioritário é o create.

---

## 2. Autenticação, headers e payload

### Login
- `POST {BRBYTE_API_URL}/login`
- `Content-Type: application/x-www-form-urlencoded`
- Body: `username`, `password`
- Cookie esperado: `BRBOSCookie=...`

### Create / list / invoice
- `POST {BRBYTE_API_URL}{path}`
- Headers: `Accept: application/json`, `Content-Type: application/x-www-form-urlencoded`, `Cookie: BRBOSCookie=...`
- Body: `URLSearchParams` montado em `brbyteAdminPostForm`
- **Regra crítica:** campos com `value === ""` **não** são enviados (`if (value !== "") body.set(...)`)

### Payload create (`buildCreateInterestForm`)
Campos típicos: `lead_pk`, `interest_status`, `interest_type` (`0` PF / `1` PJ), nome/sobrenome, docs, telefone, e-mail, endereço, `plan_pk`, `interest_obs`, opcional `client_date_birth`.

---

## 3. Evidências de causa (código)

### Causa **provável (alta confiança no código; confirmação no ERP pendente)**

`client_date_birth` é enviado como **ISO `YYYY-MM-DD`** (`row.referred_birth_date`), enquanto:

- `formatControllrBirthDate` produz **`DD/MM/YYYY`**
- esse formatter é usado em observação/`interest_obs` e na UI
- **não** é aplicado em `buildCreateInterestForm` ao montar `client_date_birth`

Trecho atual (serviço):

```ts
...(row.referred_birth_date
  ? { client_date_birth: row.referred_birth_date }
  : {}),
```

Isso é o principal candidato a HTTP 400 de validação do Controllr quando a data de nascimento está preenchida.

### Causas **secundárias / também possíveis**

1. **Campos obrigatórios omitidos** por string vazia (e-mail, endereço parcial).
2. **`lead_pk` / `plan_pk` / `interest_status`** inválidos na configuração de ambiente.
3. Respostas 400 em **formatos alternativos** de `invoice/list` e `client_interest/list` (tentativas sequenciais) — ruído operacional, não necessariamente o incidente principal.

### O que **não** está confirmado sem log de produção

- Mensagem textual exata do Controllr no 400.
- Se o ERP exige todos os campos de endereço mesmo vazios.
- Se `interest_status`/`lead_pk` do tenant estão corretos.

Marcado: **pendente de confirmação** com amostra sanitizada de `brbyte_sync_runs.error_summary` / histórico em produção.

---

## 4. A resposta original do ERP era descartada?

| Camada | Comportamento anterior | Após 1.1A |
|--------|------------------------|-----------|
| `admin-http` | Logava `bodyPreview` cru (até 300 chars — risco de PII) e `message: "HTTP {status}"` | Log **sanitizado** (`responseMessageHint`, keys, field inventory); sem body cru |
| `create-interest.service` | Persistia `response` no histórico/sync run; preferia `payload.message` | Mantém response + adiciona `form_risks` e `http_diagnostics` sanitizados; usa `responseMessageHint` se não houver `message` |
| UI admin | Podia mostrar só “HTTP 400” | Sem mudança de UI nesta sprint |

Conclusão: a resposta **não era totalmente descartada** (ia para auditoria), mas o **log HTTP** priorizava preview cru e a **mensagem operacional** degenerava para `HTTP 400` quando o ERP não usava a chave `message`.

---

## 5. Alterações desta sprint (diagnóstico apenas)

| Arquivo | Tipo |
|---------|------|
| `lib/brbyte/http-error-diagnostics.ts` | novo — classificação, inventário, riscos, sanitização |
| `lib/brbyte/http-error-diagnostics.test.ts` | novo — testes sem rede |
| `lib/brbyte/admin-http.ts` | diagnóstico sanitizado em falhas |
| `lib/brbyte/create-interest.service.ts` | preflight de riscos + persistência de diagnostics |
| `docs/SPRINT-01-1A-CONTROLLR-400-DIAGNOSTICS.md` | este relatório |
| `docs/README.md` | link para o relatório |
| `package.json` | incluir teste no script `test:brbyte` |

**Não feito:** correção do formato de data, mudança de payload, chamada real ao ERP, migration, deploy, commit.

---

## 6. Plano Sprint 1.1B (correção controlada)

Ver documento dedicado: [SPRINT-01-1B-CONTROLLR-400-CORRECAO.md](./SPRINT-01-1B-CONTROLLR-400-CORRECAO.md).

Resumo: converter `client_date_birth` para `DD/MM/YYYY` somente no payload; banco permanece ISO; sem alteração global de campos vazios.

---

## 7. Riscos

- `.env.local` com Supabase cloud: risco de apontar ao banco de produção em testes manuais com `DATA_PROVIDER=supabase`.
- Credenciais BRByte ausentes localmente nesta máquina — adequado para não escrever no ERP.
- Persistência de `http_diagnostics` em histórico pode aumentar volume de JSON de auditoria (sem PII de valores de formulário no diagnostics; form completo ainda pode ir em `meta.request` — comportamento pré-existente).
