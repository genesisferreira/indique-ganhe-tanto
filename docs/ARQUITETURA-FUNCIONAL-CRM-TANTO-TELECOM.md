# Arquitetura Funcional — CRM Tanto Telecom

| Campo | Valor |
|---|---|
| **Documento** | `docs/ARQUITETURA-FUNCIONAL-CRM-TANTO-TELECOM.md` |
| **Tipo** | Constituição funcional do CRM |
| **Versão** | 1.0 |
| **Data** | 2026-07-30 |
| **Status** | Oficial — referência obrigatória para Sprints |
| **Fontes** | Código em produção; auditoria técnica do repositório |
| **Escopo desta versão** | Documentação apenas (sem alteração de código, banco, envs ou deploy) |

---

## 1. Identificação do documento

Este documento é a **constituição funcional** do CRM da Tanto Telecom.

Ele define:

- o estado atual comprovado no código;
- as regras de negócio futuras aprovadas para evolução;
- os princípios permanentes de arquitetura;
- os limites do que ainda depende do ERP (Controllr);
- o roadmap de implementação.

Qualquer Sprint, PR ou decisão de produto relacionada ao CRM deve estar alinhada a este documento.

---

## 2. Objetivo

Registrar, de forma oficial e auditável:

1. o que o CRM **já faz** em produção;
2. o que o CRM **passará a fazer** como plataforma comercial, operacional e financeira;
3. o que permanece **pendente de confirmação** junto ao ERP/Controllr;
4. como preservar produção, identidade visual e portabilidade para servidor próprio.

---

## 3. Escopo

### Dentro do escopo

- Indique e Ganhe (indicador, comercial, admin, carteira, Pix, recompensas);
- distribuição comercial e SLA existentes;
- integração parcial Controllr/BRByte;
- evolução para setores, funções múltiplas e remuneração de funcionários;
- módulos futuros: Cobrança, Retenção, Upgrade, Pós-venda;
- sincronização diária, auditoria, segurança, ambientes e portabilidade.

### Fora do escopo deste documento

- implementação de código;
- migrations;
- alteração de variáveis de ambiente;
- inventário de dados reais de produção;
- documentação confidencial de credenciais.

---

## 4. Estado atual do CRM

### 4.1 Stack comprovada

| Camada | Tecnologia |
|---|---|
| Frontend / Backend | Next.js (App Router), TypeScript, Tailwind, shadcn/ui |
| Banco / Auth / Storage / Realtime | Supabase (PostgreSQL) |
| Deploy / Cron | Vercel |
| ERP | Controllr (integração parcial via BRByte/admin HTTP) |

### 4.2 Capacidades já existentes em produção

Comprovado no código atual:

- cadastro e login de usuários;
- papéis: `indicador`, `comercial`, `admin_consulta`, `admin_financeiro`, `admin_master`;
- indicação de clientes (incluindo nascimento, vencimento, ofertas comerciais);
- pré-cadastro público sem recompensa;
- distribuição comercial com round-robin e limites diários;
- SLA comercial e redistribuição;
- pipeline comercial;
- notificações e auditoria parcial;
- carteira do indicador, rewards, Pix e comprovantes;
- criação de Interessado no Controllr;
- detecção de conversão (cliente) no Controllr;
- acompanhamento da primeira fatura e crédito da recompensa do indicador com valor da fatura.

### 4.3 O que ainda não existe no código

- módulos Upgrade, Pós-venda, Retenção;
- Cobrança operacional completa (há apenas placeholder de cobrança no legado BRByte);
- setores e funções múltiplas por funcionário;
- motor de remuneração de funcionários separado da carteira do indicador;
- carência configurável de 2 meses para Upgrade/Pós-venda;
- confirmação automática de mudança/redução de plano no ERP;
- solicitação automática de alteração de plano via API.

### 4.4 Identidade visual

O layout e a identidade visual atuais do CRM **devem ser preservados**.

Evoluções futuras podem reorganizar informação, menus e fluxos, mas não substituir a identidade visual estabelecida.

---

## 5. Princípios arquiteturais

1. **O ERP é a fonte oficial da verdade** para clientes, contratos, planos, velocidades, valores, instalação, ativação, faturas, pagamentos, inadimplência, cancelamentos e produtos contratados.

2. O CRM pode registrar ações, intenções, contatos e **conversões informadas**, mas eventos que dependem do ERP só são válidos após **confirmação oficial** no ERP.

3. Valores de comissão, percentuais, regras, setores, funções e períodos **não devem ficar fixados diretamente no código**.

4. O **Admin** deve configurar as regras pelo sistema.

5. A **carteira do Indique e Ganhe** permanece separada das **remunerações de funcionários**.

6. Toda operação financeira deve possuir **auditoria**.

7. O sistema deve impedir **duplicidade** de pagamentos e comissões.

8. O sistema deve ser preparado para **migração futura a servidor próprio**.

9. Vercel e Supabase são a infraestrutura atual, mas **não devem impedir a portabilidade**.

10. O **layout e a identidade visual atuais** devem ser preservados, com melhorias apenas de organização e experiência.

---

## 6. ERP como fonte oficial

### 6.1 Regra central

Qualquer marcação manual no CRM **não** é confirmação definitiva de:

- conversão financeira;
- mudança de plano;
- pagamento;
- instalação;
- ativação;
- cancelamento.

Esses eventos só geram direito financeiro após confirmação no ERP.

### 6.2 Capacidade Controllr comprovada no código atual

| Capacidade | Status |
|---|---|
| Criar Interessado | Confirmado |
| Listar Interessado / detectar `client_pk` | Confirmado |
| Obter `contract_pk` | Confirmado |
| Listar faturas do contrato | Confirmado |
| Detalhe da fatura (`invoice_msg`, crédito, valores) | Confirmado |
| `plan_pk` no create/list | Parcial (sem detalhe de plano) |
| Plano atual (nome/velocidade/valor) | Pendente de confirmação |
| Histórico / redução / upgrade de plano | Pendente de confirmação |
| Data de instalação | Pendente de confirmação |
| Inadimplência / dias de atraso | Pendente de confirmação |
| Pagamento parcial oficial | Pendente de confirmação |
| Solicitação automática de mudança de plano | Não encontrado no código |
| Cancelamento / produtos add-on | Pendente de confirmação |

### 6.3 Endpoints Controllr ativos no código

- `/login`
- `/controllrctl/client_interest/create`
- `/controllrctl/client_interest/list`
- `/invoice_ctl/invoice/list`
- `/invoice_ctl/invoice/list_info`

Outros paths legados existem no repositório, mas o cron atual de lifecycle usa o fluxo Controllr admin/invoice acima.

---

## 7. Perfis, funcionários, setores e funções

### 7.1 Estado atual

Hoje o sistema possui um único `role` por perfil (`profiles.role`), com enum fixo.

Isso **não** atende ao modelo futuro de múltiplas funções simultâneas.

### 7.2 Modelo futuro obrigatório

- um único login por funcionário;
- uma ou várias funções ao mesmo tempo;
- setores configuráveis no Admin;
- funções configuráveis no Admin;
- permissões por função, setor e, quando necessário, individuais;
- menus dinâmicos conforme acesso;
- relatórios filtrados pelo acesso.

### 7.3 Funções iniciais

- Cobrança
- Retenção
- Pós-venda
- Upgrade
- Comercial
- Técnico
- Vendedor externo

Novas funções poderão ser criadas futuramente sem alteração estrutural do núcleo.

### 7.4 Status do funcionário

| Status | Recebe novos clientes? |
|---|---|
| ativo | Sim |
| pausado | Não |
| férias | Não |
| afastado | Não |
| desligado | Não |

Somente funcionários **ativos** recebem novos atendimentos/clientes elegíveis.

---

## 8. Permissões

### 8.1 Atual

- middleware (produção) + shell autenticado + RLS Supabase;
- papéis administrativos distintos (`admin_consulta` leitura; financeiro/master escrita em áreas sensíveis).

### 8.2 Futuro

Permissões deverão considerar:

- setor;
- função(ões);
- escopo de fila;
- acesso a dados pessoais;
- acesso financeiro;
- acesso a configuração de regras;
- auditoria de alterações de permissão.

Nenhuma permissão financeira crítica deve depender apenas de UI.

---

## 9. Distribuição

### 9.1 Regras

- Se houver **um** funcionário ativo no setor: todos os clientes elegíveis vão para ele.
- Se houver **mais de um**: distribuição equilibrada por **round-robin**.
- A distribuição de cada setor é **independente**.

### 9.2 Operações previstas

- atribuição automática;
- atribuição manual;
- transferência;
- redistribuição;
- bloqueio de atendimento simultâneo indevido;
- histórico de responsáveis;
- tratamento de pausa, férias, afastamento e desligamento;
- auditoria de toda alteração.

### 9.3 Reaproveitamento atual

Já existe round-robin comercial para indicações (`assign_referral_to_next_commercial`), disponibilidade, limite diário e redistribuição por SLA.

Esse motor deve ser **generalizado** para setores futuros, sem misturar filas.

---

## 10. Motor de remuneração de funcionários

### 10.1 Separação obrigatória

O motor de remuneração de funcionários **não** deve reutilizar:

- `rewards`
- `wallet_transactions`
- `payments` do indicador
- carteira do Indique e Ganhe

Esses artefatos permanecem exclusivos do programa de indicação.

### 10.2 Tipos de remuneração

- percentual;
- valor fixo em reais;
- percentual por faixa;
- valor por evento;
- valor por plano;
- valor por produto;
- regra por setor;
- regra por função;
- regra por funcionário;
- regra associada a uma ou várias funções.

### 10.3 Campos de regra (quando aplicável)

- nome;
- descrição;
- setor;
- função;
- funcionário;
- tipo;
- percentual;
- valor fixo;
- base de cálculo;
- evento que gera o direito;
- evento que confirma o direito;
- vigência inicial;
- vigência final;
- prioridade;
- aprovação;
- pagamento parcial;
- limite;
- cancelamento;
- snapshot da regra aplicada;
- auditoria.

### 10.4 Estados sugeridos da remuneração

- aguardando confirmação;
- confirmada;
- aguardando fechamento;
- incluída no fechamento;
- cancelada;
- paga;
- validação pendente.

### 10.5 Imutabilidade histórica

Alterações futuras nas regras **não** podem modificar remunerações já calculadas.

O cálculo deve gravar **snapshot** da regra vigente no momento da confirmação.

---

## 11. Cobrança

### 11.1 Regras de negócio iniciais (configuráveis no Admin)

| Regra inicial | Valor de partida | Observação |
|---|---|---|
| Entrada na fila | após **5 dias** de atraso | Configurável |
| Comissão padrão | **2%** sobre valor efetivamente recuperado | Configurável |
| Comissão agravada | **10%** com **2 ou mais** faturas vencidas | Configurável |

### 11.2 Requisitos funcionais

- comissão somente sobre valor efetivamente recebido;
- suporte a pagamento parcial;
- consulta de todas as faturas vencidas;
- última fatura gerada;
- última fatura paga;
- confirmação de pagamento pelo ERP antes de criar comissão;
- prevenção contra duplicidade;
- histórico de contatos, retornos e negociação;
- distribuição entre funcionários do setor Cobrança.

### 11.3 Pendente de confirmação no ERP

- endpoint oficial de inadimplentes;
- campo oficial de dias de atraso;
- tratamento oficial de pagamento parcial;
- identificação oficial de múltiplas faturas vencidas.

---

## 12. Retenção

### 12.1 Objetivo

Atender clientes em risco de cancelamento, com registro completo de contato e resultado.

### 12.2 Requisitos

- identificação de clientes em risco (**fonte ERP pendente de confirmação**);
- contatos e negociação;
- resultado do atendimento;
- retenção confirmada;
- comissão fixa ou percentual (configurável);
- validação pelo ERP quando o resultado depender de contrato/pagamento/plano;
- histórico;
- distribuição por setor Retenção.

---

## 13. Upgrade

### 13.1 Objetivo

Permitir que o funcionário negocie aumento de plano com base no **plano atual oficial do ERP**.

### 13.2 Filtros da página do funcionário

A página deverá filtrar clientes pelo plano atual no ERP, por exemplo:

- 200 Mega;
- 300 Mega;
- 500 Mega;
- 700 Mega;
- 1 Giga;
- demais planos existentes no ERP.

Os planos **não** devem ser tratados apenas como textos fixos no código. A classificação depende dos dados oficiais do ERP.

**Pendente de confirmação:** endpoint/consulta Controllr que retorne plano atual, velocidade e valor de forma confiável.

### 13.3 Dados esperados na fila/detalhe

- cliente;
- telefone;
- contrato;
- plano atual;
- valor atual;
- data de instalação;
- situação financeira;
- produtos;
- último contato;
- responsável;
- próxima elegibilidade.

### 13.4 Fluxo atual (com alteração manual no ERP)

1. funcionário seleciona o cliente;
2. realiza contato;
3. registra conversão no CRM (**conversão informada**);
4. status fica “conversão informada”;
5. CRM registra “aguardando alteração no ERP”;
6. alteração do plano é feita **manualmente** no ERP;
7. CRM consulta o ERP;
8. ERP confirma o novo plano;
9. comissão é criada;
10. CRM continua verificando o plano diariamente até o pagamento;
11. se houver redução antes do pagamento, comissão é cancelada;
12. se permanecer no plano ou aumentar, comissão é mantida;
13. depois de paga, alterações posteriores não geram cancelamento pelas regras atuais.

### 13.5 Fluxo futuro (automação preparada)

1. funcionário converte no CRM;
2. CRM solicita mudança pela API do ERP;
3. ERP processa;
4. CRM consulta novamente o ERP;
5. somente após confirmação efetiva do plano no ERP a comissão é criada.

O retorno positivo da solicitação de API **não** é suficiente para gerar comissão.

---

## 14. Regra de redução de plano (Upgrade)

### 14.1 Exemplo canônico

Plano confirmado no Upgrade: **700 Mega**.

| Situação posterior (antes do pagamento) | Efeito |
|---|---|
| Permanece em 700 Mega | Comissão mantida |
| Muda para 1 Giga (superior) | Comissão mantida |
| Reduz para 500 Mega | Comissão cancelada |
| Volta para 300 Mega | Comissão cancelada |

### 14.2 Regras de cancelamento

- a regra vale **até o pagamento** da comissão;
- somente uma **confirmação positiva do ERP** de redução pode cancelar;
- falha de conexão, timeout ou indisponibilidade **não** cancelam comissão;
- após paga, alterações posteriores de plano não geram estorno pelas regras atuais (salvo futura mudança configurada).

### 14.3 Dia do pagamento

1. executar consulta ao ERP;
2. validar novamente os planos das comissões do lote;
3. recalcular o fechamento;
4. bloquear o lote;
5. pagar;
6. marcar como pago.

### 14.4 Carência do Upgrade

Após conversão ou encerramento do atendimento:

- o cliente não volta à fila durante **2 meses** (valor inicial);
- o período é **configurável** no Admin;
- o histórico permanece disponível;
- o cliente não aparece como elegível durante a carência.

---

## 15. Pós-venda

### 15.1 Objetivo

Acompanhar clientes conforme o tempo desde a **instalação** (dado oficial do ERP).

### 15.2 Filtros esperados

- 7 dias;
- 15 dias;
- 1 mês;
- 2 meses;
- progressivamente até 12 meses ou mais;
- faixas configuráveis.

O sistema deve evitar que o mesmo cliente apareça duplicado de forma confusa em múltiplos filtros.

**Pendente de confirmação:** campo oficial de data de instalação/ativação no Controllr.

### 15.3 Resultados de atendimento

- contato realizado;
- sem resposta;
- satisfeito;
- problema identificado;
- encaminhamento ao suporte;
- oportunidade de Upgrade;
- oportunidade de produto;
- risco de cancelamento;
- retorno agendado;
- atendimento concluído.

### 15.4 Carência

Após contato e encerramento:

- carência inicial de **2 meses**;
- período configurável;
- cliente indisponível na fila durante a carência.

### 15.5 Remuneração

Pode ser:

- valor fixo;
- percentual;
- por atendimento;
- por resultado;
- por oportunidade convertida;
- por produto;
- por retenção;
- regras combinadas com outras funções.

Quando depender de plano, produto, ativação ou pagamento, o ERP confirma o evento.

---

## 16. Sincronização diária

### 16.1 Objetivo

Rotina diária (pela manhã) para reconciliar CRM × ERP.

### 16.2 Verificações previstas

- conversões pendentes;
- plano atual;
- mudança de plano;
- redução de plano;
- contratos;
- instalações;
- faturas;
- pagamentos;
- inadimplência;
- comissões ainda não pagas;
- cancelamentos;
- saúde da integração.

### 16.3 Requisitos técnicos

- horário configurável por ambiente (e, quando adequado, pelo Admin);
- idempotência;
- logs sanitizados;
- auditoria;
- tolerância a falhas;
- retry;
- bloqueio de execução concorrente;
- continuação após falha parcial;
- compatibilidade com servidor próprio;
- **não** depender exclusivamente do Vercel Cron.

### 16.4 Estado atual

Já existem crons Vercel:

- `/api/cron/commercial-sla` (diário);
- `/api/cron/brbyte-sync` (diário — lifecycle Controllr: conversão + primeira fatura).

A sincronização diária ampliada deste documento é evolução sobre essa base.

---

## 17. Estados e transições

### 17.1 Indique e Ganhe (atual)

Estados de indicação, pipeline comercial, sync BRByte e rewards/wallet já existem no código.

A evolução não deve quebrar esses estados.

### 17.2 Conversão informada × confirmada (futuro)

| Estado CRM | Significado |
|---|---|
| Conversão informada | Funcionário registrou sucesso; ERP ainda não confirmou |
| Aguardando alteração no ERP | Esperando plano/contrato/pagamento oficial |
| Confirmada pelo ERP | Evento válido para comissão |
| Cancelada por redução / regra | Direito perdido antes do pagamento |
| Paga | Fechamento concluído |

### 17.3 Comissão de funcionário (futuro)

Ver estados na seção 10.4.

---

## 18. Auditoria

Toda alteração relevante deve registrar, no mínimo:

- quem;
- quando;
- o quê;
- antes/depois (quando aplicável);
- origem (UI, cron, API, sync ERP);
- correlação com referral/atendimento/comissão.

Operações financeiras exigem trilha completa e imutável o quanto for tecnicamente viável.

---

## 19. Segurança

Princípios:

- secrets apenas em variáveis de ambiente;
- autorização por papel/função no servidor;
- RLS e/ou equivalentes no banco;
- validação de entrada;
- prevenção de IDOR;
- logs sem senhas, tokens ou dados pessoais desnecessários;
- rotas de cron autenticadas;
- uploads com controle de acesso;
- separação rigorosa entre ambientes.

Débitos conhecidos: ver seção 24.

---

## 20. LGPD

O CRM trata dados pessoais de clientes e indicadores.

Diretrizes:

- minimizar dados coletados;
- restringir acesso por função/setor;
- registrar acessos sensíveis quando necessário;
- evitar exposição pública de comprovantes e documentos;
- não registrar secrets ou payloads completos com PII em logs;
- prever retenção e exclusão conforme política da empresa (**detalhe jurídico pendente de confirmação**).

---

## 21. Ambientes

### Produção

- domínio oficial;
- Vercel Production;
- Supabase de produção;
- dados reais.

### Homologação

- Vercel Preview ou ambiente equivalente;
- **banco separado**;
- dados fictícios;
- **nenhuma conexão com produção**.

### Desenvolvimento

- localhost;
- Supabase local ou banco exclusivo;
- nenhuma dependência de produção.

### Proteção obrigatória

Deve existir barreira contra execução de desenvolvimento ou homologação com credenciais de produção (URL/keys de banco, Controllr prod, CRON apontando para dados reais indevidos).

Estado atual da separação Preview × produção: **pendente de confirmação operacional**.

---

## 22. Banco e migrations

### 22.1 Situação atual

O repositório possui `supabase/schema.sql` e numerosos patches SQL manuais.

Isso funciona, mas eleva risco de drift entre ambientes.

### 22.2 Diretriz futura

- versionar migrations de forma ordenada e reproduzível;
- não aplicar patches ad hoc em produção sem registro;
- manter scripts de verificação de schema;
- isolar schema do Indique e Ganhe do schema futuro de remuneração de funcionários.

---

## 23. Portabilidade

### 23.1 Destino futuro

- servidor Linux;
- Docker;
- PostgreSQL;
- armazenamento S3 ou MinIO;
- scheduler próprio;
- proxy reverso;
- serviço de background;
- logs centralizados;
- backups;
- monitoramento.

### 23.2 Matriz

| Componente atual | Dependência | Risco | Alternativa futura | Cuidados |
|---|---|---|---|---|
| Next.js app | Vercel | Médio | Docker / Node | Runtime Node estável |
| PostgreSQL | Supabase | Médio | Postgres próprio | Migrar schema/RPCs/RLS |
| Auth | Supabase Auth | Alto | Self-host ou IdP | Sessão e papéis |
| Storage | Supabase Storage | Médio | S3 / MinIO | URLs assinadas |
| Realtime | Supabase Realtime | Médio | Self-host / WS | Canais e auth |
| Cron | Vercel Cron | Médio | systemd / worker | Idempotência |
| Controllr HTTP | API externa | Baixo | Igual | Credenciais por ambiente |
| Analytics Vercel | Pacote opcional | Baixo | Remover/trocar | Sem impacto de negócio |

---

## 24. Débitos técnicos e problemas atuais prioritários

| # | Débito | Prioridade |
|---|---|---|
| 1 | **Erro HTTP 400 do Controllr** | **Primeira prioridade funcional** |
| 2 | Cliente convertido permanecendo como “Em Atendimento” | Alta |
| 3 | Possível inconsistência entre pipeline, timeline, dashboard e relatórios | Alta |
| 4 | Revisão da flag `BRBYTE_AUTO_MARK_PAID` (não bloqueia crédito Controllr no fluxo atual) | Alta |
| 5 | Possível exposição pública de comprovantes (bucket) | Alta |
| 6 | Falta de separação comprovada entre ambientes | Alta |
| 7 | SQL e migrations desorganizados (patches manuais) | Média |
| 8 | Forte acoplamento a Supabase Auth, Storage, Realtime e RPC | Média |
| 9 | Dependência de Vercel Cron | Média |
| 10 | Falta de endpoints confirmados para plano detalhado, instalação, inadimplência e mudança de plano | Alta (bloqueia módulos) |

O **erro HTTP 400 do Controllr** deve ser tratado antes da expansão de módulos de negócio.

---

## 25. Dados pendentes do ERP

Lista oficial do que precisa ser confirmado com Controllr/BRByte antes das Sprints de Cobrança/Upgrade/Pós-venda:

1. endpoint/consulta de plano atual (nome, velocidade, valor);
2. histórico de mudanças de plano;
3. endpoint para solicitar alteração de plano (futuro);
4. data de instalação/ativação;
5. inadimplentes e dias de atraso;
6. semântica oficial de pagamento parcial;
7. identificação de múltiplas faturas vencidas;
8. cancelamento e status contratuais estáveis;
9. produtos/add-ons;
10. ambiente sandbox Controllr para homologação;
11. causa e payload do HTTP 400 observado em produção (**investigação prioritária**).

Enquanto não confirmados, esses itens permanecem **pendente de confirmação**.

---

## 26. Roadmap de implementação

### Fase 1 — Estabilização

- erro HTTP 400;
- status inconsistente (“Em Atendimento” pós-conversão);
- `BRBYTE_AUTO_MARK_PAID`;
- segurança (comprovantes/ambientes);
- organização de migrations.

### Fase 2 — Estrutura organizacional

- funcionários;
- setores;
- funções;
- permissões;
- distribuição multi-setor.

### Fase 3 — Motor financeiro de funcionários

- regras;
- eventos;
- cálculo;
- fechamento;
- pagamento;
- cancelamento;
- snapshot e auditoria;
- separação total da carteira do indicador.

### Fase 4 — Novos módulos

- Cobrança;
- Retenção;
- Upgrade;
- Pós-venda.

### Fase 5 — Dashboards e indicadores

- painéis por setor/função;
- indicadores operacionais e financeiros;
- sem quebrar identidade visual.

### Fase 6 — Migração para servidor próprio

- Docker;
- Postgres;
- storage compatível com S3;
- scheduler próprio;
- proxy, backups e monitoramento.

---

## 27. Critérios gerais de aceite

Uma entrega só é aceita se:

1. respeitar o ERP como fonte da verdade;
2. não misturar carteira do indicador com remuneração de funcionário;
3. não hardcodar percentuais/valores críticos de negócio;
4. manter auditoria financeira;
5. impedir duplicidade;
6. preservar produção e identidade visual;
7. marcar explicitamente pendências de ERP;
8. não depender de endpoints inventados;
9. manter caminho de portabilidade;
10. incluir plano de rollback quando tocar fluxo financeiro ou sync.

---

## 28. Glossário

| Termo | Definição |
|---|---|
| ERP / Controllr | Sistema oficial de clientes, contratos, faturas e planos |
| Conversão informada | Registro no CRM de sucesso comercial ainda não confirmado pelo ERP |
| Confirmação ERP | Validação oficial que habilita direito financeiro |
| Indique e Ganhe | Programa de indicação; carteira do indicador |
| Remuneração de funcionário | Comissão/pagamento interno por setor/função (domínio separado) |
| Round-robin | Distribuição equilibrada entre ativos do mesmo setor |
| Carência | Período em que o cliente não retorna à fila |
| Snapshot de regra | Cópia imutável da regra usada no cálculo histórico |
| Lifecycle sync | Rotina atual de conversão + primeira fatura Controllr |
| Pendente de confirmação | Item não comprovado no código ou não homologado no ERP |

---

## 29. Histórico de decisões

| Data | Decisão |
|---|---|
| 2026-07-30 | Criação deste documento como constituição funcional oficial |
| 2026-07-30 | ERP definido como fonte oficial; CRM registra intenções e confirma depois |
| 2026-07-30 | Carteira do indicador permanece separada da remuneração de funcionários |
| 2026-07-30 | Upgrade atual = alteração manual no ERP; automação futura preparada, sem gerar comissão só com ACK de API |
| 2026-07-30 | Redução de plano cancela comissão apenas até o pagamento e só com confirmação positiva do ERP |
| 2026-07-30 | Carência inicial de Upgrade/Pós-venda = 2 meses (configurável) |
| 2026-07-30 | Erro HTTP 400 Controllr = primeira prioridade funcional |
| 2026-07-30 | Roadmap oficial: Estabilização → Organização → Motor financeiro → Módulos → Dashboards → Self-host |
| 2026-07-30 | Identidade visual atual deve ser preservada |

---

## Apêndice A — Relação com o sistema atual Indique e Ganhe

O Indique e Ganhe continua operando normalmente:

- indicação;
- Interessado Controllr;
- conversão manual no ERP;
- sync de conversão;
- primeira fatura;
- recompensa do indicador;
- Pix/carteira.

A expansão do CRM **não** substitui esse fluxo; ela adiciona domínios paralelos (funcionários, setores, remuneração interna e novos módulos).

---

## Apêndice B — Referências internas

- Código: `app/`, `lib/brbyte/`, `lib/cron/`, `supabase/`
- Auditoria de permissões: `docs/AUDITORIA-PERMISSOES-RLS.md`
- Variáveis: `.env.example` (sem secrets)
- Crons: `vercel.json`

---

**Fim do documento.**
