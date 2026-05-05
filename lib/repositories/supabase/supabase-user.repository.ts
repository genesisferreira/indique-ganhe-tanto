import type { UserRepository } from "@/lib/repositories/contracts/user.repository"

export const supabaseUserRepository: UserRepository = {
  async getById() {
    throw new Error("supabaseUserRepository.getById not implemented")
  },
  async getByRole() {
    throw new Error("supabaseUserRepository.getByRole not implemented")
  },
  async getIndicadores() {
    throw new Error("supabaseUserRepository.getIndicadores not implemented")
  },
  async getComerciais() {
    throw new Error("supabaseUserRepository.getComerciais not implemented")
  },
  async updateProfile() {
    throw new Error("supabaseUserRepository.updateProfile not implemented")
  },
  async setActive() {
    throw new Error("supabaseUserRepository.setActive not implemented")
  },
  async search() {
    throw new Error("supabaseUserRepository.search not implemented")
  },
}
