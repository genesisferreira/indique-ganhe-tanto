# 13 — Estados e terminologia (seção M)

Dicionário único. A coluna "Termo na UI" é obrigatória em todas as telas
futuras de vendas e remuneração de funcionários.

| Conceito | Termo na UI | Definição | Fonte técnica |
|---|---|---|---|
| Oportunidade | Oportunidade | Interesse comercial cadastrado por funcionário | `referrals` com `origin_kind='employee'` |
| Interessado | Interessado | Pessoa/cliente potencial da oportunidade. "Fila de Interessados" = etapa **Novo** | `referred_*`, `pipeline_stage='novo'` |
| Venda | Venda | Oportunidade acompanhada pelo funcionário, em qualquer etapa (termo de navegação "Minhas vendas") | — |
| Conversão | Conversão confirmada | Contrato confirmado **pelo ERP** | evidência ERP existente (`ativado` + sync) |
| Instalação | Instalação comprovada | Só com evidência explícita; nunca inferida de "aprovada" | futura |
| Fatura gerada | Fatura gerada (comprovada / não comprovada) | Primeira fatura válida emitida, comprovada pelo ERP | `first_valid_invoice_generated` (gatilho futuro) |
| Fatura paga | Fatura paga (comprovada / não comprovada) | Integralmente paga, comprovada pelo ERP | `first_valid_invoice_fully_paid` |
| Atribuição | Papel na venda | Vínculo funcionário ↔ oportunidade em um papel | `sales_opportunity_attributions` |
| Comissão | Comissão de venda | Valor variável por venda, conforme regra vigente | regra + direito |
| Direito | Direito de comissão | Registro imutável de que uma comissão é devida (estados abaixo) | `employee_commission_entitlements` |
| Competência | Competência (mês/ano) | Período de apuração: dia 1 ao último dia, America/Sao_Paulo | `payroll_competences` |
| Salário | Salário fixo | Componente mensal configurado | `salary_*` |
| Benefício | Benefício (Vale, Transporte, Combustível) | Componentes configurados por perfil | `meal_*`, `transport_*`, `fuel_*` |
| Ajuste | Ajuste | Linha manual com motivo (positiva ou negativa) | `line_type='adjustment'` + audit event |
| Estorno | Estorno | Reversão de linha ou direito já apurado | `reversal`, `reversed` |
| Pagamento | Pagamento registrado | Registro **pelo Financeiro** de que a folha foi paga; não é transferência feita pelo sistema | `paid_at/paid_by` |

## Estados do direito de comissão (grafo liberado)

| Banco | UI funcionário | UI admin |
|---|---|---|
| `pending_evidence` | Aguardando evidência | Aguardando evidência do ERP |
| `accrued` | Apurada | Apurada |
| `approved` | Aprovada | Aprovada |
| `included_in_payroll` | Incluída na competência {AAAA-MM} | Incluída na competência |
| `paid` | Paga com a folha de {AAAA-MM} | Paga (folha) |
| `reversed` | Estornada | Estornada |
| `rejected` | Não devida | Rejeitada |

## Estados da competência

| Banco | UI |
|---|---|
| `draft` | Em apuração |
| `calculated` | Calculada (em apuração) |
| `reviewed` | Revisada |
| `closed` | Fechada (pagamento não registrado) |
| `paid` | Pagamento registrado |
| `reopened` | Reaberta (nova versão) |

## Formulações proibidas → correção

| ❌ Não usar | ✅ Usar | Por quê |
|---|---|---|
| "Saldo disponível", "Saldo", "Carteira" para comissão | "Comissões acumuladas na competência" | Não existe saque; termo do Indique e Ganhe |
| "Paga" para competência fechada | "Fechada — pagamento não registrado" | Fechar ≠ pagar |
| "Instalada" para oportunidade aprovada | "Aprovada pelo comercial" | Aprovação ≠ instalação |
| "Não paga" para fatura ausente | "Fatura não comprovada" | Ausência de dado ≠ inadimplência |
| "Solicitar saque", "Chave Pix", "Resgatar" | (não existe) | Pago junto com o salário |
| "Comissões" sem qualificador nas telas admin | "Comissões de venda (funcionários)" | `/admin/financeiro` usa "Comissões" para recompensas |
| "Recompensa", "Prêmio", "Indique e Ganhe" | (não usar) | Origem `employee` nunca gera reward |
| "Pendente" isolado | "Aguardando evidência" / "Em apuração" | "Pendente" já é status de pagamento de recompensa |
| "Garantido", "Você vai receber R$ X" | "Previsto", "Estimativa" | Valores em apuração não são pagamento confirmado |
