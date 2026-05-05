import type { RewardRepository } from "@/lib/repositories/contracts/reward.repository"

export const mockRewardRepository: RewardRepository = {
  async getByIndicador() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return []
  },

  async getSummary() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return {
      totalGanho: 1798.2,
      totalDisponivel: 299.7,
      totalPendente: 329.7,
      totalEmDesconto: 99.9,
    }
  },

  async getConfig() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return []
  },

  async updateConfig() {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return true
  },

  async processReward() {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return true
  },

  async markAvailable() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return true
  },
}
