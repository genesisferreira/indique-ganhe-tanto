# 01 — Auditoria visual e de navegação (seção A)

**Método.** Auditoria somente leitura, sem envio de formulários:

- **Código** em `fce7f5d`: `app/`, `components/`, `middleware.ts`, `lib/auth/auth-audit.ts`, `app/globals.css`.
- **Captura ao vivo** em Production (Admin Master, **somente desktop**), feita pelo agente coordenador em 12/11/2026.
- **Mobile não foi capturado ao vivo.** O desenho mobile se baseia no código: breakpoints Tailwind `sm`/`lg`, barra superior + gaveta lateral em `< lg` (`components/layout/sidebar.tsx`).

## Identidade visual atual (preservar)

| Elemento | Valor no código |
|---|---|
| Tema | escuro único (`:root` = `.dark`), fundo `oklch(0.12 0.01 250)`, card `oklch(0.16 0.01 250)` |
| Cor primária | amarelo `oklch(0.85 0.18 90)` (logo, item ativo, botão primário, `ring`) |
| Semânticas | success `oklch(0.70 0.18 145)`, warning `oklch(0.80 0.16 70)`, destructive `oklch(0.55 0.22 25)`, info `oklch(0.65 0.15 230)` |
| Tipografia | Geist / Geist Mono (`next/font/google`) |
| Raio | `--radius: 0.75rem` (cards `rounded-xl`) |
| Marca | `components/branding/tanto-brand.tsx` — símbolo "T" + logo `/branding/tanto-logo.png`; subtítulo "Indique e Ganhe" no shell |
| Shell | `AuthenticatedDashboardShell` + `Sidebar` com grupos colapsáveis (`collapsible-nav-groups.tsx`); no mobile, barra fixa no topo + overlay |
| Cabeçalho de página | `components/ui/page-header.tsx` (título, descrição, ações à direita) |

## Matriz de reutilização

| Componente existente | Reutilizar | Adaptar | Não reutilizar | Motivo |
|---|---:|---:|---:|---|
| `AuthenticatedDashboardShell` / `DashboardLayout` | ✅ | | | Mesmo shell, guarda de sessão e tema para manter a identidade |
| `Sidebar` + `collapsible-nav-groups` | | ✅ | | Incluir itens no `funcionarioNav` (Minhas vendas, Minha remuneração) e o novo grupo admin "Remuneração da equipe" |
| Barra mobile + gaveta (`lg:hidden`) | ✅ | | | Navegação mobile já existente; sem nova navegação |
| `PageHeader` | ✅ | | | Padrão de título/ações |
| `StatCard` (`components/ui/stat-card.tsx`) | | ✅ | | Cards com ícone e variantes. **Não usar a prop `trend`** com número fixo: o dashboard indicador mostra "+12 este mês" fixo mesmo com dados zerados |
| `StatusBadge` (`components/ui/status-badge.tsx`) | | ✅ | | Reaproveitar o visual, mas com **mapa de status próprio**. O mapa atual tem "Paga"/"Pago"/"Disponível", que são termos do Indique e Ganhe |
| `Card`, `Table`, `Tabs`, `Badge`, `Select`, `Input`, `Pagination`, `Skeleton`, `Empty`, `AlertDialog`, `Dialog`, `Sheet`, `Tooltip`, `Switch`, `Checkbox`, `Calendar` (shadcn em `components/ui`) | ✅ | | | Primitivos neutros |
| `data-table.tsx` | | ✅ | | Listas admin; precisa de paginação no servidor (keyset) e de colunas sanitizadas |
| Dashboard do indicador `app/indicador/page.tsx` (cards + "Indicações recentes") | | ✅ | | Referência de **layout**: grade de 4 cards + lista recente com avatar-inicial |
| Cards financeiros do indicador ("Total Recebido", "Saldo Disponível", "Saldo em Desconto", "Recompensas…") | | | ❌ | Semântica de carteira/saque; proibido (premissa 13, stop rule P) |
| Formulário `app/indicador/nova-indicacao/page.tsx` | | ✅ | | Referência de validação: `isValidPhoneBR`, `normalizeReferralPhone`, CPF, `referral-registration-acknowledgements`. Fluxo próprio: **sem** recompensa, sem Pix, sem oferta de prêmio |
| `components/referral/referral-registration-acknowledgements.tsx` | | ✅ | | Ciências/consentimento com texto próprio de funcionário (sem promessa de prêmio) |
| `components/referral/referral-interested-fields.tsx` | | ✅ | | Campos do interessado; esconder blocos ERP do funcionário |
| Lista `app/indicador/indicacoes/page.tsx` (busca + filtro de status) | | ✅ | | Mesma composição (card + busca + `Select` + tabela/cards no mobile) |
| Detalhe `app/indicador/indicacoes/[id]/page.tsx` (seção "Histórico" em linha do tempo) | | ✅ | | Linha do tempo reaproveitável, com eventos próprios. Remover recompensa/valor de prêmio |
| `app/indicador/carteira`, `pagamentos`, `comprovantes`, `chave-pix` | | | ❌ | Carteira, saque, Pix e comprovante de saque. **Nada** é reutilizado (apenas identificado) |
| `app/admin/financeiro` (Recompensas), `pagamentos-pendentes`, `historico-pagamentos`, `upload-comprovante` | | | ❌ | Fluxo de pagamento de recompensas do indicador; usa "Comissões"/"Saldo Disponível" com outro significado |
| `app/funcionario/page.tsx` ("Operação": cards de módulos por setor) | | ✅ | | Vira a seção "Operação" do novo painel; manter os links Cobrança/Retenção |
| `app/admin/funcionarios` (lista: busca + status + tabela NOME/STATUS/SETORES/ATUALIZAÇÃO/AÇÕES) | ✅ | | | Ponto de entrada para `/admin/funcionarios/[id]/vendas` e `/remuneracao` |
| `app/admin/funcionarios/[id]` (dados, gestor, setores) | | ✅ | | Adicionar abas "Vendas" e "Remuneração" (esta só para admin_master/admin_financeiro) |
| `app/admin/comerciais` | ✅ | | | Mesmo padrão de lista; nada financeiro |
| `app/admin/pipeline` + `components/pipeline/pipeline-kanban-board.tsx` + `pipeline-metrics-bar.tsx` | | ✅ | | Colunas Novo → Tentativa de contato → Contato realizado → Negociação → Agendado → Instalação → Ativado → Perdido. A oportunidade do funcionário entra em **Novo**. Adicionar um selo "Origem: funcionário" |
| Texto vazio do kanban "Arraste leads aqui" | | ✅ | | Estados vazios específicos para cada contexto |
| Gráficos do dashboard admin | | | ❌ | Sem estado vazio (captura ao vivo). Nos novos painéis, só cards e listas com `Empty` |
| `app/admin/auditoria` | | ✅ | | Padrão de tabela de logs; a auditoria financeira fica em uma rota separada |
| `/cobranca` (5 KPIs simples) | ✅ | | | Exemplo de KPI sem tendência fictícia |
| `NotificationCenter` | ✅ | | | Notificações futuras ("competência revisada") pelo mesmo centro, sem push financeiro nesta fase |
| `components/commercial/*` (badges SLA/redistribuído) | | ✅ | | Selos de estado comercial no detalhe da venda (somente leitura) |

## Achados da auditoria

1. `/admin/financeiro` é **Recompensas** do Indique e Ganhe. Os termos
   "Total em Comissões", "Total Pago", "Pendente" e "Saldo Disponível" já estão
   em uso → conflito de terminologia (ver [13](./13-terminology.md)).
2. `/admin/auditoria` já existe. A auditoria financeira de funcionários fica
   em `/admin/remuneracao/auditoria` (sem colisão de arquivo nem de significado).
3. Não existe item "Interessados" no menu. O estágio real é
   `pipeline_stage='novo'` (enum `public.pipeline_stage`) com
   `referrals.status='pendente'` (enum `public.referral_status`).
4. O enum `referral_status` contém `paga` (recompensa paga ao indicador).
   Para venda de funcionário, esse status **nunca** pode ser exibido como "paga".
5. O sidebar admin não tem link para o painel do funcionário. Isso é correto:
   `/funcionario` exige `role = funcionario`.
6. As listas admin ficaram em "Carregando…" na captura. Os novos desenhos
   definem skeleton + erro + vazio explícitos.
7. O `StatCard` com `trend` fixo é antipadrão e não deve ser copiado.
