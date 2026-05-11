import type {
  Indicacao,
  IndicacaoCreateData,
  IndicacaoFilters,
  IndicacaoStatus,
  IndicacaoUpdateData,
  MarkFirstInvoicePaidResult,
} from "@/types"
import type { PaginatedResponse } from "./user.repository"

export interface ReferralStats {
  total: number
  pendentes: number
  emAndamento: number
  aprovadas: number
  recusadas: number
}

export interface ReferralRepository {
  create(indicadorId: string, data: IndicacaoCreateData): Promise<Indicacao>
  getById(id: string): Promise<Indicacao | null>
  getAll(filters?: IndicacaoFilters, page?: number, pageSize?: number): Promise<PaginatedResponse<Indicacao>>
  getByIndicador(
    indicadorId: string,
    filters?: Omit<IndicacaoFilters, "indicadorId">,
    page?: number,
    pageSize?: number
  ): Promise<PaginatedResponse<Indicacao>>
  update(data: IndicacaoUpdateData): Promise<Indicacao | null>
  updateStatus(id: string, status: IndicacaoStatus, comercialId?: string): Promise<boolean>
  assignToComercial(indicacaoId: string, comercialId: string): Promise<boolean>
  getStats(indicadorId?: string): Promise<ReferralStats>
  markFirstInvoiceAsPaid(referralId: string): Promise<MarkFirstInvoicePaidResult>
}
