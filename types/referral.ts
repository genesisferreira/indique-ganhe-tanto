import type { CommercialSlaLevel } from '@/lib/commercial-sla'
import type { Indicador, Comercial } from './profile'
import type { Plano } from './plan'

export type IndicacaoStatus = 'pendente' | 'em_andamento' | 'em_atendimento' | 'em_negociacao' | 'aprovada' | 'recusada' | 'paga'

export type RecompensaTipo = 'pix' | 'desconto_fatura'

export interface Indicacao {
  id: string
  indicadorId: string
  indicador?: Indicador
  nomeIndicado: string
  telefoneIndicado: string
  emailIndicado?: string
  enderecoIndicado?: string
  planoId: string
  plano?: Plano
  tipoRecompensa: RecompensaTipo
  valorRecompensa: number
  status: IndicacaoStatus
  comercialId?: string
  comercial?: Comercial
  observacoes?: string
  primeiraFaturaPaga?: boolean
  /** Data em que o financeiro confirmou o pagamento da 1ª mensalidade do cliente indicado */
  dataPrimeiraFaturaPaga?: Date
  dataAprovacao?: Date
  dataRecusa?: Date
  motivoRecusa?: string
  /** Observação livre ao perder/recusar (referrals.lost_notes) */
  observacoesRecusa?: string
  /** Atribuição ao comercial */
  atribuidoEm?: Date
  primeiroContatoEm?: Date
  /** Nível SLA escalonado */
  slaLevel?: CommercialSlaLevel
  /** Legado: true se slaLevel !== 'none' */
  slaOverdue?: boolean
  redistributionCount?: number
  lastRedistributedAt?: Date
  previousCommercialId?: string
  previousCommercialNome?: string
  slaRedistributed?: boolean
  createdAt: Date
  updatedAt: Date
}

export interface IndicacaoCreateData {
  nomeIndicado: string
  telefoneIndicado: string
  emailIndicado?: string
  enderecoIndicado?: string
  planoId: string
  tipoRecompensa: RecompensaTipo
  observacoes?: string
}

export interface IndicacaoUpdateData {
  id: string
  status?: IndicacaoStatus
  comercialId?: string
  observacoes?: string
  primeiraFaturaPaga?: boolean
  motivoRecusa?: string
}

export interface IndicacaoFilters {
  status?: IndicacaoStatus | 'todas'
  indicadorId?: string
  comercialId?: string
  planoId?: string
  dataInicio?: Date
  dataFim?: Date
  search?: string
}

export type MarkFirstInvoicePaidErrorCode =
  | "forbidden"
  | "referral_not_found"
  | "already_paid"
  | "reward_not_found"
  | "reward_not_pending"
  | "already_released"
  | "rpc_error"
  | "unknown"

export type MarkFirstInvoicePaidResult =
  | { ok: true; rewardId: string; transactionId: string; balanceAfter: number }
  | { ok: false; code: MarkFirstInvoicePaidErrorCode; message: string }
