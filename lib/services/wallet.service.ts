import type { 
  Carteira, 
  Transacao, 
  ExtratoFilters, 
  CarteiraResumo
} from '@/types'
// import { createClient } from '@/lib/supabase/client'
import { walletRepository } from '@/lib/repositories'
import type { PaginatedResponse } from '@/lib/repositories/contracts/user.repository'
import type { WalletOperationResult } from '@/lib/repositories/contracts/wallet.repository'

export const walletService = {
  /**
   * Get wallet by indicador ID
   */
  async getByIndicador(indicadorId: string): Promise<Carteira | null> {
    return walletRepository.getByIndicador(indicadorId)
  },

  /**
   * Get wallet summary
   */
  async getSummary(indicadorId: string): Promise<CarteiraResumo> {
    return walletRepository.getSummary(indicadorId)
  },

  /**
   * Get transaction history (extrato)
   */
  async getExtrato(
    indicadorId: string,
    filters: ExtratoFilters = {},
    page = 1,
    pageSize = 10
  ): Promise<PaginatedResponse<Transacao>> {
    return walletRepository.getExtrato(indicadorId, filters, page, pageSize)
  },

  /**
   * Add credit to wallet
   */
  async addCredit(
    indicadorId: string,
    valor: number,
    descricao: string,
    referencia?: string
  ): Promise<Transacao> {
    return walletRepository.addCredit(indicadorId, valor, descricao, referencia)
  },

  /**
   * Process withdrawal
   */
  async processWithdrawal(
    indicadorId: string,
    valor: number
  ): Promise<WalletOperationResult> {
    return walletRepository.processWithdrawal(indicadorId, valor)
  },

  /**
   * Apply discount to invoice
   */
  async applyDiscount(
    indicadorId: string,
    valor: number
  ): Promise<WalletOperationResult> {
    return walletRepository.applyDiscount(indicadorId, valor)
  },
}
