import type { Plano, PlanoCreateData, PlanoUpdateData } from '@/types'
// import { createClient } from '@/lib/supabase/client'

// Mock implementation
import { planos as mockPlanos } from '@/lib/mock/plans'

export const planService = {
  /**
   * Get all active plans
   */
  async getAll(includeInactive = false): Promise<Plano[]> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

    if (includeInactive) {
      return mockPlanos
    }
    return mockPlanos.filter(p => p.ativo)
  },

  /**
   * Get plan by ID
   */
  async getById(id: string): Promise<Plano | null> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

    return mockPlanos.find(p => p.id === id) || null
  },

  /**
   * Create a new plan
   */
  async create(data: PlanoCreateData): Promise<Plano> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 300))

    const newPlano: Plano = {
      id: `plano-${Date.now()}`,
      ...data,
      valorRecompensa: data.valorRecompensa || data.preco,
      ativo: data.ativo ?? true,
      ordem: data.ordem ?? mockPlanos.length + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    return newPlano
  },

  /**
   * Update a plan
   */
  async update(data: PlanoUpdateData): Promise<Plano | null> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 300))

    const plano = await this.getById(data.id)
    if (!plano) return null

    return {
      ...plano,
      ...data,
      updatedAt: new Date(),
    }
  },

  /**
   * Toggle plan active status
   */
  async toggleActive(id: string): Promise<boolean> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))
    return true
  },

  /**
   * Reorder plans
   */
  async reorder(planIds: string[]): Promise<boolean> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 300))
    return true
  },
}
