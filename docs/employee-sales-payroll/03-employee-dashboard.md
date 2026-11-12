# 03 — Painel do funcionário `/funcionario` (seção C)

Wireframe: [`wireframes/01-funcionario-dashboard.html`](./wireframes/01-funcionario-dashboard.html).

## Estrutura

1. `PageHeader`: "Olá, {primeiro nome}". Descrição: "Suas oportunidades,
   vendas e remuneração do mês". Ação primária **Nova oportunidade** (só com
   membership elegível).
2. **Seletor de competência** (mês, padrão = mês corrente em America/Sao_Paulo; período 1º → último dia).
3. **Cards comerciais (sempre visíveis)**. Contagens só das oportunidades em
   que o funcionário tem atribuição:

| Card | Fonte futura | Observação |
|---|---|---|
| Oportunidades cadastradas no mês | attributions do próprio + `referrals.created_at` no mês | |
| Vendas em andamento | status ∈ {pendente, em_andamento, em_atendimento, em_negociacao} | |
| Conversões confirmadas | `pipeline_stage='ativado'` **com** evidência de conversão ERP já existente | Rótulo "Conversões confirmadas", **nunca "Instalações"** sem prova |
| Comissões aguardando evidência | entitlements `pending_evidence` | Enquanto o ERP não estiver comprovado, mostra "—" e o aviso "Regras de comissão ainda não ativas" |
| Comissões acumuladas no mês | soma `accrued + approved + included_in_payroll` da competência | Rótulo exato "Comissões acumuladas na competência (não é saldo)" |
| Histórico recente | 5 últimos eventos | lista com ícone/status |

4. **Cards de remuneração (condicionais).** Aparecem somente se o perfil de
   remuneração vigente tiver `*_enabled = true` **e** `show_* = true`:
   - salário fixo (`show_salary`);
   - vale ("{n} dias × R$ {valor}") (`show_meal`);
   - transporte (`show_transport`);
   - combustível (`show_fuel`);
   - outros ganhos e descontos: só se existirem linhas na competência;
   - **total estimado da competência**: só se ao menos um componente estiver
     visível; rótulo "Estimativa — não é pagamento".
5. **Operação**: os cards de módulos atuais (Cobrança/Retenção) são preservados.

## Nunca exibir

Carteira, saldo para saque, chave Pix, botão "Solicitar saque", remuneração de
colegas, regras internas de outros funcionários, valores de outros papéis na
mesma venda.

## Estados

| Estado | Exibição |
|---|---|
| Sem vendas | `Empty`: "Você ainda não cadastrou oportunidades neste mês." + botão Nova oportunidade |
| Venda aguardando análise | badge cinza "Aguardando análise" (status `pendente`) |
| Venda em atendimento | badge azul "Em atendimento" |
| Aprovada | badge verde "Aprovada pelo comercial". Texto: "aprovação comercial não confirma instalação" |
| Instalação/fatura não comprovada | badge âmbar "Aguardando comprovação do ERP" |
| Comissão aguardando evidência | badge âmbar "Comissão aguardando evidência" |
| Competência em apuração | faixa "Competência em apuração — valores podem mudar" (`draft`/`calculated`) |
| Competência revisada | faixa "Revisada pelo Financeiro" (`reviewed`) |
| Competência fechada | faixa "Fechada — pagamento ainda não registrado" (`closed`) |
| Pagamento registrado | faixa verde "Pagamento registrado pelo Financeiro em {data}" (`paid`) |
| Ajuste ou estorno | linha destacada "Ajuste" / "Estorno" com motivo resumido |
| Perfil sem componentes visíveis | não mostra seção de remuneração; mostra só a comissão |
| Funcionário inativo/afastado | cards somente leitura; botão Nova oportunidade oculto, com aviso |
| Erro de carregamento | `Alert` "Não foi possível carregar agora. Tente novamente." (sem detalhe técnico) |
| Carregando | `Skeleton` por card (nunca "Carregando…" eterno) |
