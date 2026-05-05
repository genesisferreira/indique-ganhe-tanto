import type { Recompensa, RecompensaSummary, RecompensaConfig } from '@/types'
// import { createClient } from '@/lib/supabase/client'
import { rewardRepository } from '@/lib/repositories'

export const rewardService = {
  /**
   * Get rewards by indicador
   */
  async getByIndicador(indicadorId: string): Promise<Recompensa[]> {
    return rewardRepository.getByIndicador(indicadorId)
  },

  /**
   * Get reward summary for indicador
   */
  async getSummary(indicadorId: string): Promise<RecompensaSummary> {
    return rewardRepository.getSummary(indicadorId)
  },

  /**
   * Get reward configuration
   */
  async getConfig(): Promise<RecompensaConfig[]> {
    return rewardRepository.getConfig()
  },

  /**
   * Update reward configuration
   */
  async updateConfig(config: RecompensaConfig): Promise<boolean> {
    return rewardRepository.updateConfig(config)
  },

  /**
   * Process reward after first invoice paid
   */
  async processReward(indicacaoId: string): Promise<boolean> {
    return rewardRepository.processReward(indicacaoId)
  },

  /**
   * Mark reward as available
   */
  async markAvailable(recompensaId: string): Promise<boolean> {
    return rewardRepository.markAvailable(recompensaId)
  },
}
