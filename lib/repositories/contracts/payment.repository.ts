import type {
  Pagamento,
  PagamentoCreateData,
  PagamentoFilters,
  PagamentoStatus,
  SolicitacaoSaque,
} from "@/types"
import type { PaginatedResponse } from "./user.repository"

export interface PendingPaymentsSummary {
  totalPendente: number
  quantidadePendente: number
  totalAprovado: number
  quantidadeAprovado: number
}

export interface PaymentRepository {
  getAll(filters?: PagamentoFilters, page?: number, pageSize?: number): Promise<PaginatedResponse<Pagamento>>
  getById(id: string): Promise<Pagamento | null>
  getByIndicador(indicadorId: string, page?: number, pageSize?: number): Promise<PaginatedResponse<Pagamento>>
  create(data: PagamentoCreateData): Promise<Pagamento>
  updateStatus(id: string, status: PagamentoStatus, comprovanteUrl?: string): Promise<boolean>
  approve(id: string, adminId: string): Promise<boolean>
  markAsPaid(id: string, comprovanteUrl: string): Promise<boolean>
  requestWithdrawal(indicadorId: string, valor: number, chavePix: string, tipoChavePix: string): Promise<SolicitacaoSaque>
  getPendingSummary(): Promise<PendingPaymentsSummary>
}
