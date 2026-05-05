import type { PaymentRepository } from "@/lib/repositories/contracts/payment.repository"

export const supabasePaymentRepository: PaymentRepository = {
  async getAll() {
    throw new Error("supabasePaymentRepository.getAll not implemented")
  },
  async getById() {
    throw new Error("supabasePaymentRepository.getById not implemented")
  },
  async getByIndicador() {
    throw new Error("supabasePaymentRepository.getByIndicador not implemented")
  },
  async create() {
    throw new Error("supabasePaymentRepository.create not implemented")
  },
  async updateStatus() {
    throw new Error("supabasePaymentRepository.updateStatus not implemented")
  },
  async approve() {
    throw new Error("supabasePaymentRepository.approve not implemented")
  },
  async markAsPaid() {
    throw new Error("supabasePaymentRepository.markAsPaid not implemented")
  },
  async requestWithdrawal() {
    throw new Error("supabasePaymentRepository.requestWithdrawal not implemented")
  },
  async getPendingSummary() {
    throw new Error("supabasePaymentRepository.getPendingSummary not implemented")
  },
}
