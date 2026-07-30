# Indique e Ganhe - Tanto Telecom

Sistema completo de programa de indicações para a Tanto Telecom. Permite que clientes indiquem amigos e recebam recompensas quando as indicações se tornam clientes ativos.

## Stack Utilizada

- **Framework:** Next.js 15 (App Router)
- **Linguagem:** TypeScript
- **Estilização:** Tailwind CSS 4
- **Componentes:** shadcn/ui
- **Ícones:** Lucide React
- **Banco de Dados:** Supabase (preparado para integração)
- **Autenticação:** Supabase Auth (preparado para integração)
- **Deploy:** Vercel

## Funcionalidades

### Área Pública
- Landing page com informações do programa
- Login com seleção de perfil
- Cadastro de indicadores
- Recuperação de senha

### Área do Indicador
- Dashboard com estatísticas pessoais
- Formulário de nova indicação
- Lista de indicações com filtros
- Detalhes da indicação com timeline
- Carteira digital com saldo
- Solicitação de pagamento/saque
- Comprovantes de pagamento
- Cadastro de chave PIX
- Perfil do usuário

### Área do Comercial
- Dashboard com métricas de performance
- Lista de leads atribuídos
- Detalhes do lead com timeline de interações
- Agenda de retornos
- Histórico de atendimentos
- Desempenho pessoal
- Controle de disponibilidade

### Área Administrativa
- Dashboard executivo com gráficos
- Gestão de indicadores
- Gestão de comerciais
- Gestão de indicações com atribuição
- Aprovação de pagamentos
- Relatórios gerenciais
- Configurações do sistema

## Estrutura do Projeto

```
├── app/                      # Rotas e páginas (App Router)
│   ├── admin/               # Área administrativa
│   ├── comercial/           # Área do comercial
│   ├── indicador/           # Área do indicador
│   ├── login/               # Página de login
│   ├── cadastro/            # Página de cadastro
│   └── recuperar-senha/     # Recuperação de senha
├── components/              # Componentes React
│   ├── layout/             # Componentes de layout
│   ├── ui/                 # Componentes base (shadcn/ui)
│   └── dashboard/          # Componentes de dashboard
├── lib/                    # Utilitários e configurações
│   ├── mock/              # Dados mockados
│   ├── services/          # Serviços de API
│   ├── supabase/          # Cliente Supabase
│   └── utils.ts           # Funções utilitárias
├── types/                  # Tipagens TypeScript
├── hooks/                  # React Hooks customizados
└── middleware.ts           # Middleware de autenticação
```

## Como Rodar Localmente

### Pré-requisitos
- Node.js 18+
- pnpm (recomendado) ou npm

### Instalação

```bash
# Clonar o repositório
git clone https://github.com/genesisferreira/indique-ganhe-tanto.git
cd indique-ganhe-tanto

# Instalar dependências
pnpm install

# Copiar arquivo de ambiente
cp .env.example .env.local

# Rodar em desenvolvimento
pnpm dev
```

Acesse [http://localhost:3000](http://localhost:3000) no navegador.

## Conectar Supabase

### 1. Criar projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um novo projeto
2. Copie as credenciais do projeto

### 2. Configurar variáveis de ambiente

Edite o arquivo `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=sua_url_do_supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_anon_key
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
```

### 3. Criar tabelas no Supabase

Execute o seguinte SQL no SQL Editor do Supabase:

```sql
-- Tabela de usuários (extensão da auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  nome text not null,
  email text not null unique,
  telefone text not null,
  role text not null default 'indicador',
  avatar text,
  ativo boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Tabela de indicadores
create table public.indicadores (
  id uuid references public.profiles on delete cascade primary key,
  cpf text not null unique,
  chave_pix text,
  tipo_chave_pix text,
  total_indicacoes integer default 0,
  indicacoes_aprovadas integer default 0,
  total_recebido decimal(10,2) default 0,
  saldo_disponivel decimal(10,2) default 0,
  saldo_desconto decimal(10,2) default 0
);

-- Tabela de planos
create table public.planos (
  id uuid default gen_random_uuid() primary key,
  nome text not null,
  velocidade text not null,
  preco decimal(10,2) not null,
  descricao text,
  valor_recompensa decimal(10,2) not null,
  ativo boolean default true,
  ordem integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Tabela de indicações
create table public.indicacoes (
  id uuid default gen_random_uuid() primary key,
  indicador_id uuid references public.indicadores not null,
  nome_indicado text not null,
  telefone_indicado text not null,
  email_indicado text,
  endereco_indicado text,
  plano_id uuid references public.planos not null,
  tipo_recompensa text not null,
  valor_recompensa decimal(10,2) not null,
  status text default 'pendente',
  comercial_id uuid references public.profiles,
  observacoes text,
  primeira_fatura_paga boolean default false,
  data_aprovacao timestamp with time zone,
  data_recusa timestamp with time zone,
  motivo_recusa text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Tabela de pagamentos
create table public.pagamentos (
  id uuid default gen_random_uuid() primary key,
  indicador_id uuid references public.indicadores not null,
  indicacao_id uuid references public.indicacoes not null,
  valor decimal(10,2) not null,
  tipo text not null,
  status text default 'pendente',
  data_vencimento timestamp with time zone not null,
  data_pagamento timestamp with time zone,
  comprovante_url text,
  observacoes text,
  aprovado_por uuid references public.profiles,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Habilitar RLS
alter table public.profiles enable row level security;
alter table public.indicadores enable row level security;
alter table public.planos enable row level security;
alter table public.indicacoes enable row level security;
alter table public.pagamentos enable row level security;

-- Políticas de segurança (exemplo básico)
create policy "Usuários podem ver seu próprio perfil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Planos ativos são públicos"
  on public.planos for select
  using (ativo = true);
```

### 4. Ativar serviços

Após criar as tabelas, atualize os services em `lib/services/` para usar o Supabase ao invés dos mocks.

## Perfis de Usuário

| Perfil | Descrição | Permissões |
|--------|-----------|------------|
| `indicador` | Cliente que indica amigos | Criar indicações, ver carteira, solicitar pagamentos |
| `comercial` | Vendedor que atende leads | Gerenciar leads, registrar interações |
| `admin_consulta` | Admin somente leitura | Visualizar relatórios e dados |
| `admin_financeiro` | Admin financeiro | Aprovar pagamentos, gerar relatórios |
| `admin_master` | Admin completo | Acesso total ao sistema |

## Deploy

O projeto está configurado para deploy na Vercel:

1. Conecte o repositório na Vercel
2. Configure as variáveis de ambiente
3. Deploy automático em cada push

## Documentação

- [Índice da documentação](./docs/README.md)
- [Arquitetura Funcional do CRM](./docs/ARQUITETURA-FUNCIONAL-CRM-TANTO-TELECOM.md) — constituição funcional oficial para as próximas Sprints
- [Auditoria de permissões (RLS)](./docs/AUDITORIA-PERMISSOES-RLS.md)

## Built with v0

This repository is linked to a [v0](https://v0.app) project.

[Continue working on v0](https://v0.app/chat/projects/prj_e1Yd00xSKXNDW3m6AQvXlxqinMBY)

## Licença

Projeto proprietário - Tanto Telecom © 2024
