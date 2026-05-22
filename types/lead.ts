import type { CommercialSlaLevel } from '@/lib/commercial-sla'
import type { Indicacao } from './referral'
import type { Comercial } from './profile'

export type LeadStatus = 'novo' | 'em_atendimento' | 'sem_contato' | 'em_negociacao' | 'vendido' | 'perdido' | 'redistribuido'

export interface Lead {
  id: string
  indicacaoId: string
  indicacao?: Indicacao
  comercialId: string
  comercial?: Comercial
  status: LeadStatus
  primeiroContato?: Date
  ultimoContato?: Date
  retornoAgendado?: Date
  observacoes: string[]
  tentativasContato?: number
  /** Momento da atribuição ao comercial (referrals.assigned_at) */
  assignedAt?: Date | null
  /** Primeiro contato registrado (referrals.first_response_at) */
  firstResponseAt?: Date | null
  /** Nível SLA escalonado (15 / 30 / 45 min) */
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

export interface LeadFilters {
  status?: LeadStatus | 'todos'
  comercialId?: string
  dataInicio?: Date
  dataFim?: Date
  comRetorno?: boolean
}

export interface Historico {
  id: string
  leadId: string
  comercialId: string
  comercial?: Comercial
  acao: string
  descricao: string
  createdAt: Date
}

export interface HistoricoCreateData {
  leadId: string
  acao: string
  descricao: string
}

export interface RetornoAgendado {
  id: string
  leadId: string
  lead?: Lead
  dataRetorno: Date
  observacao?: string
  concluido: boolean
  createdAt: Date
}
