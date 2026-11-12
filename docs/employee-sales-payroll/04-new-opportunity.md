# 04 — Nova oportunidade `/funcionario/nova-oportunidade` (seção D)

Wireframe: [`wireframes/02-nova-oportunidade.html`](./wireframes/02-nova-oportunidade.html).

O formulário do Indique e Ganhe (`app/indicador/nova-indicacao/page.tsx`) é
referência visual e de validação. O fluxo é **próprio**: sem recompensa, sem
oferta de prêmio, sem Pix.

## Base existente lida (H1, liberada)

RPC `public.create_employee_sales_opportunity` (`patch-employee-origin-and-rewards-hardening-3-1f-h1.sql`).

**Parâmetros:** `p_idempotency_key, p_attribution_role, p_sector_id, p_plan_id,
p_referred_name, p_referred_phone, p_referred_email?, p_referred_observation?`.

**Garantias no banco:**
- `indicator_profile_id = NULL`, `reward_eligible = false`, `reward_type/amount = NULL`;
- `origin_kind = 'employee'`, `source = 'employee_sales_opportunity'`, `status = 'pendente'`;
- `pipeline_stage = 'novo'` (default) → **"Interessados" = coluna "Novo"**;
- a atribuição do criador é gravada em `sales_opportunity_attributions`;
- evento de segurança `employee_opportunity_created`;
- idempotência por `referrals_employee_opportunity_idem_uidx`.

**Códigos de retorno:** `unauthenticated`, `invalid_idempotency_key`,
`invalid_attribution_role`, `invalid_payload`, `forbidden`,
`employee_not_active`, `membership_not_active`, `idempotency_conflict`,
`{ok:true, idempotent:true|false, opportunity_id}`.

**Duplicidade — regras existentes hoje:**
1. Idempotência (mesma chave = mesma oportunidade).
2. Pré-cadastro público: `findRecentDuplicate`, por **documento + source**
   dentro de uma janela de minutos.
3. O formulário do indicador **não** bloqueia telefone/CPF repetido; ele só valida o formato.

**Gaps (futura migration, J3 — não agora):**
- a RPC não recebe endereço, bairro/cidade, documento nem a versão do aceite de ciência;
- não verifica papel × setor (a RPC `attribute_employee_sales_opportunity` verifica);
- não detecta duplicidade por telefone/documento;
- `search_path = public` sem `pg_temp`.

## Campos

| Campo | Obrigatório | Validação (reuso) | Observação |
|---|---|---|---|
| Nome do interessado | sim | `btrim`, 3–120 caracteres | |
| Telefone/WhatsApp | sim | `isValidPhoneBR` + `normalizeReferralPhone` | checkbox "É WhatsApp" |
| Endereço (logradouro, número) | sim (J3) | texto | **Gap**: precisa de parâmetro novo |
| Bairro / Cidade | sim (J3) | texto + UF | **Gap** |
| Plano ou interesse | sim | lista de planos ativos (`plans.is_active`) | "Interesse" livre controlado se não houver plano |
| Observações comerciais | não | até 500 caracteres; aviso "não inclua CPF, senha, dados bancários" | sanitização no servidor |
| CPF/documento | opcional (J3) | `isValidCPF` | Só para checar duplicidade; nunca exibido de volta por inteiro |
| Ciência/consentimento | sim | checkbox: "O interessado autorizou o contato da Tanto Telecom" + "Não prometi disponibilidade técnica nem prazo" | Texto próprio; nunca os textos de prêmio do Indique e Ganhe |
| Papel de atribuição | derivado | membership ativa: technician → `technician_originator`; external_sales → `external_sales_originator`; commercial → `internal_sales_responsible` | Se houver mais de um, `RadioGroup` "Seu papel nesta venda"; o padrão é a função principal |
| Responsável interno | condicional | só para técnico/vendedor externo; lista de funcionários com membership `commercial` ativa, **sem** o próprio usuário | Vinculado depois pelo Admin via `attribute_employee_sales_opportunity` (só admin hoje). Ver a questão em aberto Q1 |

## Regras

- Criação **somente pela RPC própria**, chamada pelo servidor com o JWT do usuário (nunca service_role).
- A chave de idempotência é gerada no cliente ao abrir o formulário (UUID → base64url, 32 caracteres) e reutilizada em reenvios.
- Clique duplo: o botão fica desabilitado + spinner enquanto a requisição está pendente; o reenvio usa a mesma chave.
- Duplicidade: aviso **"Já existe um interessado com este telefone em atendimento"** (sem nome nem dados do outro registro). No J3 isso bloqueia a criação; a decisão sobre permitir é Q2.
- Não prometer disponibilidade técnica; não criar contrato/fatura; não calcular comissão; **nunca** criar reward.
- O mesmo funcionário nunca ocupa dois papéis (`sales_opportunity_attributions_employee_uq`).

## Mensagens e estados

| Situação | Origem | Mensagem ao funcionário |
|---|---|---|
| Criado | `ok:true, idempotent:false` | "Oportunidade cadastrada. Ela já está na fila de Interessados do comercial." |
| Já existente (mesma chave) | `idempotent:true` | "Esta oportunidade já foi cadastrada. Nenhum registro duplicado foi criado." |
| Duplicidade | futura checagem J3 | "Já existe um interessado com este telefone em atendimento. Fale com o comercial." |
| Interesse em atendimento | futura (status ≠ pendente) | "Este interessado já está em atendimento comercial." |
| Sem função compatível | `membership_not_active` / `invalid_attribution_role` | "Seu cadastro não tem uma função que permita registrar vendas. Procure o administrador." |
| Funcionário inativo/afastado | `employee_not_active` / `forbidden` | "Seu cadastro de funcionário não está ativo no momento." |
| Erro temporário | rede/5xx | "Não foi possível enviar agora. Seus dados continuam no formulário; tente novamente." |
| Operação repetida | `idempotency_conflict` | "Esta solicitação já foi usada. Recarregue a página e tente novamente." |
| Dados inválidos | `invalid_payload` | Mensagem por campo |
