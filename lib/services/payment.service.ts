import type { 
  Pagamento, 
  PagamentoCreateData, 
  PagamentoFilters, 
  PagamentoStatus,
  SolicitacaoSaque 
} from '@/types'
// import { createClient } from '@/lib/supabase/client'

// Mock implementation
import { pagamentos as mockPagamentos } from '@/lib/mock/payments'

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export const paymentService = {
  /**
   * Get all payments with filters
   */
  async getAll(
    filters: PagamentoFilters = {},
    page = 1,
    pageSize = 10
  ): Promise<PaginatedResponse<Pagamento>> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

    let data = [...mockPagamentos]

    // Apply filters
    if (filters.status && filters.status !== 'todos') {
      data = data.filter(p => p.status === filters.status)
    }
    if (filters.indicadorId) {
      data = data.filter(p => p.indicadorId === filters.indicadorId)
    }
    if (filters.tipo) {
      data = data.filter(p => p.tipo === filters.tipo)
    }

    const total = data.length
    const start = (page - 1) * pageSize
    const paginatedData = data.slice(start, start + pageSize)

    return {
      data: paginatedData,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  },

  /**
   * Get payment by ID
   */
  async getById(id: string): Promise<Pagamento | null> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

    return mockPagamentos.find(p => p.id === id) || null
  },

  /**
   * Get payments by indicador
   */
  async getByIndicador(
    indicadorId: string,
    page = 1,
    pageSize = 10
  ): Promise<PaginatedResponse<Pagamento>> {
    return this.getAll({ indicadorId }, page, pageSize)
  },

  /**
   * Create payment request
   */
  async create(data: PagamentoCreateData): Promise<Pagamento> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 300))

    const newPagamento: Pagamento = {
      id: `pag-${Date.now()}`,
      ...data,
      status: 'pendente',
      dataVencimento: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    return newPagamento
  },

  /**
   * Update payment status
   */
  async updateStatus(
    id: string, 
    status: PagamentoStatus, 
    comprovanteUrl?: string
  ): Promise<boolean> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))
    return true
  },

  /**
   * Approve payment
   */
  async approve(id: string, adminId: string): Promise<boolean> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))
    return true
  },

  /**
   * Mark payment as paid
   */
  async markAsPaid(id: string, comprovanteUrl: string): Promise<boolean> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))
    return true
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
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 300))

    return {
      id: `saque-${Date.now()}`,
      indicadorId,
      valor,
      chavePix,
      tipoChavePix,
      status: 'pendente',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  },

  /**
   * Get pending payments summary
   */
  async getPendingSummary(): Promise<{
    totalPendente: number
    quantidadePendente: number
    totalAprovado: number
    quantidadeAprovado: number
  }> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

    const pendentes = mockPagamentos.filter(p => p.status === 'pendente')
    const aprovados = mockPagamentos.filter(p => p.status === 'aprovado')

    return {
      totalPendente: pendentes.reduce((sum, p) => sum + p.valor, 0),
      quantidadePendente: pendentes.length,
      totalAprovado: aprovados.reduce((sum, p) => sum + p.valor, 0),
      quantidadeAprovado: aprovados.length,
    }
  },
}
