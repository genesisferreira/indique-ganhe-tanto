import type { PlanRepository } from "@/lib/repositories/contracts/plan.repository"
import { mockDataService } from "@/lib/services/mock-data.service"

export const mockPlanRepository: PlanRepository = {
  async getAll(includeInactive = false) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { planos } = mockDataService.getSnapshot()
    if (includeInactive) return planos
    return planos.filter((item) => item.ativo)
  },

  async getById(id) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { planos } = mockDataService.getSnapshot()
    return planos.find((item) => item.id === id) || null
  },

  async create(data) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const { planos } = mockDataService.getSnapshot()
    return {
      id: `plano-${Date.now()}`,
      ...data,
      valorRecompensa: data.valorRecompensa || data.preco,
      ativo: data.ativo ?? true,
      ordem: data.ordem ?? planos.length + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  },

  async update(data) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const plano = await this.getById(data.id)
    if (!plano) return null
    return { ...plano, ...data, updatedAt: new Date() }
  },

  async toggleActive() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return true
  },

  async reorder() {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return true
  },
}
