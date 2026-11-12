# 14 — Fluxos (Mermaid)

## 1. Criação de oportunidade pelo funcionário

```mermaid
sequenceDiagram
  actor F as Funcionário
  participant UI as /funcionario/nova-oportunidade
  participant API as POST /api/employee/sales-opportunities
  participant RPC as create_employee_sales_opportunity (JWT do usuário)
  participant DB as referrals + attributions
  F->>UI: preenche + ciência
  UI->>UI: gera Idempotency-Key; desabilita botão
  UI->>API: payload + Idempotency-Key
  API->>API: revalida role=funcionario
  API->>RPC: chamada com o JWT (nunca service_role)
  RPC->>RPC: employee ativo? membership ativa? chave repetida?
  alt chave já usada pelo mesmo funcionário
    RPC-->>API: ok, idempotent=true
  else nova
    RPC->>DB: referral origin_kind=employee, reward_eligible=false, status=pendente, pipeline_stage=novo
    RPC->>DB: attribution (papel do criador)
    RPC-->>API: ok, opportunity_id
  end
  API-->>UI: mensagem "na fila de Interessados"
  Note over DB: Nenhuma reward, carteira, Pix, ERP ou comissão
```

## 2. Atribuição (até 3 papéis, 1 papel por funcionário)

```mermaid
flowchart TD
  O[Oportunidade origin_kind=employee] --> A1[Técnico originador]
  O --> A2[Vendedor externo]
  O --> A3[Responsável interno]
  A1 & A2 & A3 --> C{Validações}
  C -->|papel já ocupado| E1[attribution_role_taken]
  C -->|mesmo funcionário em outro papel| E2[employee_already_attributed]
  C -->|setor incompatível| E3[role_sector_incompatible]
  C -->|ok| OK[(attributions append-only)]
```

## 3. Ciclo da comissão (grafo do direito liberado)

```mermaid
stateDiagram-v2
  [*] --> pending_evidence: (futuro) gatilho com regra ativa
  pending_evidence --> accrued: evidência ERP comprovada
  pending_evidence --> rejected
  accrued --> approved
  accrued --> reversed
  accrued --> rejected
  approved --> included_in_payroll
  approved --> reversed
  included_in_payroll --> paid: pagamento da competência registrado
  included_in_payroll --> reversed
  paid --> [*]
  reversed --> [*]
  rejected --> [*]
  note right of pending_evidence
    Hoje: inserção bloqueada (financial_rules_inactive).
    Nenhum direito existe.
  end note
```

## 4. Ciclo da competência (desenho; schema tem também `reopened`)

```mermaid
stateDiagram-v2
  [*] --> draft: open_payroll_competence_draft
  draft --> calculated: Calcular (futuro)
  calculated --> draft: recalcular
  calculated --> reviewed: Revisar (futuro)
  reviewed --> calculated: divergência
  reviewed --> closed: Fechar (bloqueado até J10)
  closed --> paid: Registrar pagamento (bloqueado até J10)
  closed --> reopened: Reabrir com motivo = nova versão
  paid --> reopened: Reabrir com motivo = nova versão
  reopened --> draft
```

## 5. Permissões

```mermaid
flowchart LR
  subgraph Login
    AM[admin_master]
    AF[admin_financeiro]
    AC[admin_consulta]
    FU[funcionario]
  end
  FU -->|próprios dados| P1["/funcionario/*"]
  FU -->|se gestor: equipe sem valores| P2["/funcionario/equipe"]
  AC -->|vendas sem valores| P3["/admin/funcionarios/:id/vendas"]
  AC -.->|403| P4["/admin/remuneracao/*"]
  AM --> P4
  AF --> P4
  AM --> P3
  AF --> P3
```
