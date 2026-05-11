import type { ReferralRepository } from "@/lib/repositories/contracts/referral.repository"
import { markFirstInvoiceAsPaidFromSupabase } from "@/lib/services/supabase-data.service"

export const supabaseReferralRepository: ReferralRepository = {
  async create() {
    throw new Error("supabaseReferralRepository.create not implemented")
  },
  async getById() {
    throw new Error("supabaseReferralRepository.getById not implemented")
  },
  async getAll() {
    throw new Error("supabaseReferralRepository.getAll not implemented")
  },
  async getByIndicador() {
    throw new Error("supabaseReferralRepository.getByIndicador not implemented")
  },
  async update() {
    throw new Error("supabaseReferralRepository.update not implemented")
  },
  async updateStatus() {
    throw new Error("supabaseReferralRepository.updateStatus not implemented")
  },
  async assignToComercial() {
    throw new Error("supabaseReferralRepository.assignToComercial not implemented")
  },
  async getStats() {
    throw new Error("supabaseReferralRepository.getStats not implemented")
  },
  async markFirstInvoiceAsPaid(referralId) {
    return markFirstInvoiceAsPaidFromSupabase(referralId)
  },
}
