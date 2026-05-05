import type { 
  Indicacao, 
  IndicacaoCreateData, 
  IndicacaoUpdateData, 
  IndicacaoFilters,
  IndicacaoStatus 
} from '@/types'
// import { createClient } from '@/lib/supabase/client'
import { referralRepository } from '@/lib/repositories'
import type { PaginatedResponse } from '@/lib/repositories/contracts/user.repository'
import type { ReferralStats } from '@/lib/repositories/contracts/referral.repository'

export const referralService = {
  /**
   * Create a new indicação
   */
  async create(indicadorId: string, data: IndicacaoCreateData): Promise<Indicacao> {
    return referralRepository.create(indicadorId, data)
  },

  /**
   * Get indicação by ID
   */
  async getById(id: string): Promise<Indicacao | null> {
    return referralRepository.getById(id)
  },

  /**
   * Get all indicações with filters
   */
  async getAll(
    filters: IndicacaoFilters = {},
    page = 1,
    pageSize = 10
  ): Promise<PaginatedResponse<Indicacao>> {
    return referralRepository.getAll(filters, page, pageSize)
  },

  /**
   * Get indicações by indicador
   */
  async getByIndicador(
    indicadorId: string,
    filters: Omit<IndicacaoFilters, 'indicadorId'> = {},
    page = 1,
    pageSize = 10
  ): Promise<PaginatedResponse<Indicacao>> {
    return referralRepository.getByIndicador(indicadorId, filters, page, pageSize)
  },

  /**
   * Update indicação
   */
  async update(data: IndicacaoUpdateData): Promise<Indicacao | null> {
    return referralRepository.update(data)
  },

  /**
   * Update indicação status
   */
  async updateStatus(id: string, status: IndicacaoStatus, comercialId?: string): Promise<boolean> {
    return referralRepository.updateStatus(id, status, comercialId)
  },

  /**
   * Assign indicação to comercial
   */
  async assignToComercial(indicacaoId: string, comercialId: string): Promise<boolean> {
    return referralRepository.assignToComercial(indicacaoId, comercialId)
  },

  /**
   * Get statistics
   */
  async getStats(indicadorId?: string): Promise<ReferralStats> {
    return referralRepository.getStats(indicadorId)
  },
}
