import type { Carteira, CarteiraResumo, ExtratoFilters, Transacao } from "@/types"
import type { PaginatedResponse } from "./user.repository"

export interface WalletOperationResult {
  success: boolean
  error?: string
}

export interface WalletRepository {
  getByIndicador(indicadorId: string): Promise<Carteira | null>
  getSummary(indicadorId: string): Promise<CarteiraResumo>
  getExtrato(
    indicadorId: string,
    filters?: ExtratoFilters,
    page?: number,
    pageSize?: number
  ): Promise<PaginatedResponse<Transacao>>
  addCredit(indicadorId: string, valor: number, descricao: string, referencia?: string): Promise<Transacao>
  processWithdrawal(indicadorId: string, valor: number): Promise<WalletOperationResult>
  applyDiscount(indicadorId: string, valor: number): Promise<WalletOperationResult>
}
