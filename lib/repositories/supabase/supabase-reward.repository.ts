import type { RewardRepository } from "@/lib/repositories/contracts/reward.repository"

export const supabaseRewardRepository: RewardRepository = {
  async getByIndicador() {
    throw new Error("supabaseRewardRepository.getByIndicador not implemented")
  },
  async getSummary() {
    throw new Error("supabaseRewardRepository.getSummary not implemented")
  },
  async getConfig() {
    throw new Error("supabaseRewardRepository.getConfig not implemented")
  },
  async updateConfig() {
    throw new Error("supabaseRewardRepository.updateConfig not implemented")
  },
  async processReward() {
    throw new Error("supabaseRewardRepository.processReward not implemented")
  },
  async markAvailable() {
    throw new Error("supabaseRewardRepository.markAvailable not implemented")
  },
}
