# Integração Supabase (Arquitetura por Repositórios)

Este documento descreve como ativar Supabase no projeto sem alterar a UI.

## Visão geral

O projeto usa uma arquitetura com contratos de repositório:

- Contratos: `lib/repositories/contracts/*`
- Implementação mock atual: `lib/repositories/mock/*`
- Esqueleto Supabase: `lib/repositories/supabase/*`
- Seleção de provider: `lib/repositories/index.ts` via `DATA_PROVIDER`

A UI depende de `lib/services/*`, e os services dependem de repositórios.
Assim, a troca de fonte de dados acontece apenas no provider.

## DATA_PROVIDER

Variável de ambiente:

- `DATA_PROVIDER=mock`: usa implementação mock (recomendado até concluir Supabase)
- `DATA_PROVIDER=supabase`: usa implementação Supabase

### Aviso importante

Mantenha `DATA_PROVIDER=mock` enquanto os repositórios em `lib/repositories/supabase/*` não estiverem implementados.

Atualmente os arquivos Supabase são stubs e lançam erro `"not implemented"`.

## Variáveis necessárias

Configure no `.env.local` (copiando de `.env.example`):

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATA_PROVIDER=mock
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=Indique e Ganhe - Tanto Telecom
```

## Ordem correta de migração

1. Validar contratos atuais em `lib/repositories/contracts/*`.
2. Implementar repositórios Supabase em `lib/repositories/supabase/*` por domínio.
3. Garantir tipagem do banco em `types/database.ts` compatível com schema real.
4. Validar services sem alterar páginas/componentes.
5. Rodar validações locais (`tsc`, lint, smoke test de páginas críticas).
6. Só então trocar `DATA_PROVIDER` para `supabase` em ambiente de teste.
7. Validar autenticação, autorização, consultas e estados vazios.
8. Promover para produção após checklist completo.

## Checklist para ativar Supabase

- [ ] `types/database.ts` gerado a partir do projeto Supabase real.
- [ ] Repositórios Supabase implementados para todos os contratos usados.
- [ ] `DATA_PROVIDER=mock` mantido durante desenvolvimento inicial.
- [ ] Queries com tratamento de erro e retorno tipado.
- [ ] Normalização de datas e relacionamentos preservada nos repositórios.
- [ ] Fluxos críticos validados: login, dashboard, listagens, detalhe, pagamentos.
- [ ] Middleware de autenticação/autorização validado no ambiente alvo.
- [ ] `DATA_PROVIDER=supabase` habilitado primeiro em staging.
- [ ] Rollback definido: voltar para `DATA_PROVIDER=mock` se necessário.

## Instruções para migrations (depois)

Quando iniciar banco real, adote migrations versionadas.

### Fluxo recomendado

1. Criar migration inicial com schema base (tabelas, índices, RLS, policies).
2. Versionar SQL em pasta de migrations.
3. Aplicar primeiro em ambiente de desenvolvimento/staging.
4. Rodar smoke tests de leitura/escrita por domínio.
5. Aplicar em produção apenas após validação.

### Regras importantes

- Nunca aplicar mudanças de schema diretamente em produção sem versionamento.
- Toda mudança de schema deve vir acompanhada de atualização em `types/database.ts`.
- Manter migrações idempotentes quando possível e com estratégia de rollback.

## Estratégia de rollback

Se ocorrer falha após ativar Supabase:

1. Voltar `DATA_PROVIDER=mock`.
2. Rebuild/redeploy.
3. Investigar domínio específico no repositório Supabase correspondente.
4. Corrigir e repetir testes em staging antes de nova ativação.
