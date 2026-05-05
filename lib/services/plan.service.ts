import type { Plano, PlanoCreateData, PlanoUpdateData } from '@/types'
// import { createClient } from '@/lib/supabase/client'
import { planRepository } from '@/lib/repositories'

export const planService = {
  /**
   * Get all active plans
   */
  async getAll(includeInactive = false): Promise<Plano[]> {
    return planRepository.getAll(includeInactive)
  },

  /**
   * Get plan by ID
   */
  async getById(id: string): Promise<Plano | null> {
    return planRepository.getById(id)
  },

  /**
   * Create a new plan
   */
  async create(data: PlanoCreateData): Promise<Plano> {
    return planRepository.create(data)
  },

  /**
   * Update a plan
   */
  async update(data: PlanoUpdateData): Promise<Plano | null> {
    return planRepository.update(data)
  },

  /**
   * Toggle plan active status
   */
  async toggleActive(id: string): Promise<boolean> {
    return planRepository.toggleActive(id)
  },

  /**
   * Reorder plans
   */
  async reorder(planIds: string[]): Promise<boolean> {
    return planRepository.reorder(planIds)
  },
}
