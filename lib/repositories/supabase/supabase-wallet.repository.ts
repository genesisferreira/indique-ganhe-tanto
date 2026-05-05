import type { WalletRepository } from "@/lib/repositories/contracts/wallet.repository"

export const supabaseWalletRepository: WalletRepository = {
  async getByIndicador() {
    throw new Error("supabaseWalletRepository.getByIndicador not implemented")
  },
  async getSummary() {
    throw new Error("supabaseWalletRepository.getSummary not implemented")
  },
  async getExtrato() {
    throw new Error("supabaseWalletRepository.getExtrato not implemented")
  },
  async addCredit() {
    throw new Error("supabaseWalletRepository.addCredit not implemented")
  },
  async processWithdrawal() {
    throw new Error("supabaseWalletRepository.processWithdrawal not implemented")
  },
  async applyDiscount() {
    throw new Error("supabaseWalletRepository.applyDiscount not implemented")
  },
}
