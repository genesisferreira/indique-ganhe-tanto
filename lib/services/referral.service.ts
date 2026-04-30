import type { 
  Indicacao, 
  IndicacaoCreateData, 
  IndicacaoUpdateData, 
  IndicacaoFilters,
  IndicacaoStatus 
} from '@/types'
// import { createClient } from '@/lib/supabase/client'

// Mock implementation
import { indicacoes as mockIndicacoes } from '@/lib/mock/referrals'

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export const referralService = {
  /**
   * Create a new indicação
   */
  async create(indicadorId: string, data: IndicacaoCreateData): Promise<Indicacao> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 300))

    const newIndicacao: Indicacao = {
      id: `ind-${Date.now()}`,
      indicadorId,
      nomeIndicado: data.nomeIndicado,
      telefoneIndicado: data.telefoneIndicado,
      emailIndicado: data.emailIndicado,
      enderecoIndicado: data.enderecoIndicado,
      planoId: data.planoId,
      tipoRecompensa: data.tipoRecompensa,
      valorRecompensa: 0, // Will be calculated based on plan
      status: 'pendente',
      observacoes: data.observacoes,
      primeiraFaturaPaga: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    return newIndicacao
  },

  /**
   * Get indicação by ID
   */
  async getById(id: string): Promise<Indicacao | null> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

    return mockIndicacoes.find(i => i.id === id) || null
  },

  /**
   * Get all indicações with filters
   */
  async getAll(
    filters: IndicacaoFilters = {},
    page = 1,
    pageSize = 10
  ): Promise<PaginatedResponse<Indicacao>> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

    let data = [...mockIndicacoes]

    // Apply filters
    if (filters.status && filters.status !== 'todas') {
      data = data.filter(i => i.status === filters.status)
    }
    if (filters.indicadorId) {
      data = data.filter(i => i.indicadorId === filters.indicadorId)
    }
    if (filters.comercialId) {
      data = data.filter(i => i.comercialId === filters.comercialId)
    }
    if (filters.planoId) {
      data = data.filter(i => i.planoId === filters.planoId)
    }
    if (filters.search) {
      const search = filters.search.toLowerCase()
      data = data.filter(i => 
        i.nomeIndicado.toLowerCase().includes(search) ||
        i.telefoneIndicado.includes(search)
      )
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
   * Get indicações by indicador
   */
  async getByIndicador(
    indicadorId: string,
    filters: Omit<IndicacaoFilters, 'indicadorId'> = {},
    page = 1,
    pageSize = 10
  ): Promise<PaginatedResponse<Indicacao>> {
    return this.getAll({ ...filters, indicadorId }, page, pageSize)
  },

  /**
   * Update indicação
   */
  async update(data: IndicacaoUpdateData): Promise<Indicacao | null> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 300))

    const indicacao = await this.getById(data.id)
    if (!indicacao) return null

    return {
      ...indicacao,
      ...data,
      updatedAt: new Date(),
    }
  },

  /**
   * Update indicação status
   */
  async updateStatus(id: string, status: IndicacaoStatus, comercialId?: string): Promise<boolean> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))
    return true
  },

  /**
   * Assign indicação to comercial
   */
  async assignToComercial(indicacaoId: string, comercialId: string): Promise<boolean> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))
    return true
  },

  /**
   * Get statistics
   */
  async getStats(indicadorId?: string): Promise<{
    total: number
    pendentes: number
    emAndamento: number
    aprovadas: number
    recusadas: number
  }> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

    let data = [...mockIndicacoes]
    if (indicadorId) {
      data = data.filter(i => i.indicadorId === indicadorId)
    }

    return {
      total: data.length,
      pendentes: data.filter(i => i.status === 'pendente').length,
      emAndamento: data.filter(i => i.status === 'em_atendimento' || i.status === 'em_negociacao').length,
      aprovadas: data.filter(i => i.status === 'aprovada' || i.status === 'paga').length,
      recusadas: data.filter(i => i.status === 'recusada').length,
    }
  },
}
