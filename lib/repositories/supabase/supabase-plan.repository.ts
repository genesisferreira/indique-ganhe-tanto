import type { PlanRepository } from "@/lib/repositories/contracts/plan.repository"

export const supabasePlanRepository: PlanRepository = {
  async getAll() {
    throw new Error("supabasePlanRepository.getAll not implemented")
  },
  async getById() {
    throw new Error("supabasePlanRepository.getById not implemented")
  },
  async create() {
    throw new Error("supabasePlanRepository.create not implemented")
  },
  async update() {
    throw new Error("supabasePlanRepository.update not implemented")
  },
  async toggleActive() {
    throw new Error("supabasePlanRepository.toggleActive not implemented")
  },
  async reorder() {
    throw new Error("supabasePlanRepository.reorder not implemented")
  },
}
