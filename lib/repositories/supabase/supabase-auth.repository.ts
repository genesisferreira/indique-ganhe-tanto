import type { AuthRepository } from "@/lib/repositories/contracts/auth.repository"

export const supabaseAuthRepository: AuthRepository = {
  async login() {
    throw new Error("supabaseAuthRepository.login not implemented")
  },
  async register() {
    throw new Error("supabaseAuthRepository.register not implemented")
  },
  async logout() {
    throw new Error("supabaseAuthRepository.logout not implemented")
  },
  async getCurrentUser() {
    throw new Error("supabaseAuthRepository.getCurrentUser not implemented")
  },
  async resetPassword() {
    throw new Error("supabaseAuthRepository.resetPassword not implemented")
  },
  async updatePassword() {
    throw new Error("supabaseAuthRepository.updatePassword not implemented")
  },
}
