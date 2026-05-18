import type { Indicador } from './profile'
import type { Indicacao, RecompensaTipo } from './referral'
import type { TipoChavePix } from './profile'

export type PagamentoStatus = 'pendente' | 'aprovado' | 'pago' | 'cancelado' | 'rejeitado'

export type PagamentoKind = 'referral_reward' | 'pix_withdrawal'

export interface Pagamento {
  id: string
  indicadorId: string
  indicador?: Indicador
  /** Ausente em saques Pix avulsos */
  indicacaoId?: string
  indicacao?: Indicacao
  valor: number
  tipo: RecompensaTipo
  status: PagamentoStatus
  dataVencimento: Date
  dataPagamento?: Date
  comprovanteUrl?: string
  observacoes?: string
  aprovadoPor?: string
  /** referral_reward (padrão) ou pix_withdrawal */
  kind?: PagamentoKind
  motivoRejeicao?: string
  /** Chave Pix registrada no momento da solicitação (mascarada na UI se necessário) */
  pixChaveSnapshot?: string
  pixTipoChave?: TipoChavePix
  createdAt: Date
  updatedAt?: Date
}

export interface PagamentoCreateData {
  indicadorId: string
  indicacaoId: string
  valor: number
  tipo: RecompensaTipo
}

export interface PagamentoFilters {
  status?: PagamentoStatus | 'todos'
  indicadorId?: string
  tipo?: RecompensaTipo
  /** Quando definido, filtra saques Pix ou pagamentos de indicação */
  kind?: PagamentoKind | 'todos'
  dataInicio?: Date
  dataFim?: Date
}

export interface SolicitacaoSaque {
  id: string
  indicadorId: string
  valor: number
  chavePix: string
  tipoChavePix: string
  status: 'pendente' | 'aprovado' | 'pago' | 'rejeitado'
  motivoRejeicao?: string
  createdAt: Date
  updatedAt: Date
}

export type AuditoriaPagamentoAcao =
  | 'create'
  | 'update'
  | 'approve'
  | 'reject'
  | 'delete'
  | 'login'
  | 'logout'

export interface AuditoriaPagamentoItem {
  id: string
  acao: AuditoriaPagamentoAcao
  actorProfileId: string | null
  createdAt: Date
  dadosAnteriores: Record<string, unknown> | null
  dadosNovos: Record<string, unknown> | null
  metadata: Record<string, unknown>
}

export type PixWithdrawalRpcResult =
  | {
      ok: true
      idempotent?: boolean
      paymentId?: string
      status?: string
      balanceAfter?: number
      walletTransactionId?: string
    }
  | { ok: false; code: string; message: string }
