import type { 
  Pagamento, 
  PagamentoCreateData, 
  PagamentoFilters, 
  PagamentoStatus,
  SolicitacaoSaque 
} from '@/types'
// import { createClient } from '@/lib/supabase/client'
import { paymentRepository } from '@/lib/repositories'
import type { PaginatedResponse } from '@/lib/repositories/contracts/user.repository'
import type { PendingPaymentsSummary } from '@/lib/repositories/contracts/payment.repository'

export const paymentService = {
  /**
   * Get all payments with filters
   */
  async getAll(
    filters: PagamentoFilters = {},
    page = 1,
    pageSize = 10
  ): Promise<PaginatedResponse<Pagamento>> {
    return paymentRepository.getAll(filters, page, pageSize)
  },

  /**
   * Get payment by ID
   */
  async getById(id: string): Promise<Pagamento | null> {
    return paymentRepository.getById(id)
  },

  /**
   * Get payments by indicador
   */
  async getByIndicador(
    indicadorId: string,
    page = 1,
    pageSize = 10
  ): Promise<PaginatedResponse<Pagamento>> {
    return paymentRepository.getByIndicador(indicadorId, page, pageSize)
  },

  /**
   * Create payment request
   */
  async create(data: PagamentoCreateData): Promise<Pagamento> {
    return paymentRepository.create(data)
  },

  /**
   * Update payment status
   */
  async updateStatus(
    id: string, 
    status: PagamentoStatus, 
    comprovanteUrl?: string
  ): Promise<boolean> {
    return paymentRepository.updateStatus(id, status, comprovanteUrl)
  },

  /**
   * Approve payment
   */
  async approve(id: string, adminId: string): Promise<boolean> {
    return paymentRepository.approve(id, adminId)
  },

  /**
   * Mark payment as paid
   */
  async markAsPaid(id: string, comprovanteUrl: string): Promise<boolean> {
    return paymentRepository.markAsPaid(id, comprovanteUrl)
  },

  /**
   * Request withdrawal (saque)
   */
  async requestWithdrawal(
    indicadorId: string,
    valor: number,
    chavePix: string,
    tipoChavePix: string
  ): Promise<SolicitacaoSaque> {
    return paymentRepository.requestWithdrawal(indicadorId, valor, chavePix, tipoChavePix)
  },

  /**
   * Get pending payments summary
   */
  async getPendingSummary(): Promise<PendingPaymentsSummary> {
    return paymentRepository.getPendingSummary()
  },
}
