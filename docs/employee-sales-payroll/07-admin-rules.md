# 07 — Admin: regras de comissão `/admin/remuneracao/regras` (seção G)

Wireframe: [`06-admin-regras.html`](./wireframes/06-admin-regras.html). Acesso: `admin_master | admin_financeiro`.

## Lista

Colunas: função/setor, papel, método, gatilho, valor/taxa, base percentual,
vigência (de/até), versão, status (Rascunho / Ativa / Inativa / Substituída),
criado por, aprovado por, alterado em. Filtros: status, papel, método.
Ação por linha: "Nova versão" (draft) e "Ver histórico".

## Formulário de rascunho (RPCs existentes `create_commission_rule_draft` / `version_commission_rule_draft`)

| Campo | Mapeamento | Regra |
|---|---|---|
| Setor / papel | `sector_id`, `attribution_role` | pelo menos um |
| Método | `fixed_amount` · `percentage` · `first_invoice_value` | **Percentual** desabilitado ("Base percentual ainda não comprovada no ERP"). **Primeira fatura** desabilitado ("Valor pago da primeira fatura não comprovado") |
| Gatilho | derivado: fixo/percentual → `first_valid_invoice_generated`; primeira fatura → `first_valid_invoice_fully_paid` | somente leitura |
| Valor fixo | `fixed_amount` numeric(10,2) > 0 | máscara BRL |
| Taxa | `percentage_rate` 0 < x ≤ 1, até 6 casas | entrada em % ("2,00 %" → 0.02) |
| Base percentual | `percentage_base` | desabilitado enquanto `ERP_PAID_AMOUNT_PROVEN=NO` |
| Vigência | `effective_from` ≥ hoje (America/Sao_Paulo) | **sem retroatividade** (`retroactive=false` é CHECK) |
| Idempotência | `p_idempotency_key` gerada ao abrir o formulário | |

## Modelos sugeridos (não inseridos)

Cartões "Usar como ponto de partida" preenchem o formulário **somente no
navegador**; nada é salvo até "Salvar rascunho".

| Modelo | Preenchimento | Disponível hoje |
|---|---|---|
| Técnico | papel `technician_originator`, fixo R$ 30,00 | sim, como rascunho |
| Vendedor externo | papel `external_sales_originator`, fixo R$ 50,00 | sim, como rascunho |
| Responsável interno | papel `internal_sales_responsible`, percentual 2% | **não**: percentual desabilitado (base não comprovada) |
| Vale | R$ 22,00/dia | é benefício: abre o perfil de remuneração (doc 08), não regra |

## Enquanto o ERP não for comprovado

- Botão **Ativar** desabilitado, com tooltip **"Aguardando validação da integração financeira"**. Reforçado no banco por `employee_commission_rules_foundation_inactive_chk`.
- Só é possível **salvar rascunho**. Não existe RPC de ativação/aprovação (ver gaps em 15).
- Retroatividade: o campo não existe na UI; a vigência passada é rejeitada.
- Faixa no topo: "Nenhuma regra está ativa. Comissões não são calculadas automaticamente."
