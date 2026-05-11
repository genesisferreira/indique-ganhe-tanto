import type { ReferralRepository } from "@/lib/repositories/contracts/referral.repository"
import type { MarkFirstInvoicePaidResult } from "@/types"
import { mockDataService } from "@/lib/services/mock-data.service"

export const mockReferralRepository: ReferralRepository = {
  async create(indicadorId, data) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return {
      id: `ind-${Date.now()}`,
      indicadorId,
      nomeIndicado: data.nomeIndicado,
      telefoneIndicado: data.telefoneIndicado,
      emailIndicado: data.emailIndicado,
      enderecoIndicado: data.enderecoIndicado,
      planoId: data.planoId,
      tipoRecompensa: data.tipoRecompensa,
      valorRecompensa: 0,
      status: "pendente",
      observacoes: data.observacoes,
      primeiraFaturaPaga: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  },

  async getById(id) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { indicacoes } = mockDataService.getSnapshot()
    return indicacoes.find((item) => item.id === id) || null
  },

  async getAll(filters = {}, page = 1, pageSize = 10) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { indicacoes } = mockDataService.getSnapshot()
    let data = [...indicacoes]

    if (filters.status && filters.status !== "todas") {
      data = data.filter((item) => item.status === filters.status)
    }
    if (filters.indicadorId) {
      data = data.filter((item) => item.indicadorId === filters.indicadorId)
    }
    if (filters.comercialId) {
      data = data.filter((item) => item.comercialId === filters.comercialId)
    }
    if (filters.planoId) {
      data = data.filter((item) => item.planoId === filters.planoId)
    }
    if (filters.search) {
      const search = filters.search.toLowerCase()
      data = data.filter(
        (item) =>
          item.nomeIndicado.toLowerCase().includes(search) ||
          item.telefoneIndicado.includes(search)
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

  async getByIndicador(indicadorId, filters = {}, page = 1, pageSize = 10) {
    return this.getAll({ ...filters, indicadorId }, page, pageSize)
  },

  async update(data) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const indicacao = await this.getById(data.id)
    if (!indicacao) return null
    return { ...indicacao, ...data, updatedAt: new Date() }
  },

  async updateStatus() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return true
  },

  async assignToComercial() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return true
  },

  async markFirstInvoiceAsPaid(referralId): Promise<MarkFirstInvoicePaidResult> {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const { indicacoes } = mockDataService.getSnapshot()
    const indicacao = indicacoes.find((i) => i.id === referralId)
    if (!indicacao) {
      return {
        ok: false,
        code: "referral_not_found",
        message: "Indicação não encontrada (mock).",
      }
    }
    if (indicacao.primeiraFaturaPaga) {
      return {
        ok: false,
        code: "already_paid",
        message: "A primeira mensalidade deste cliente já foi confirmada.",
      }
    }
    if (indicacao.status !== "aprovada" && indicacao.status !== "paga") {
      return {
        ok: false,
        code: "reward_not_found",
        message:
          "Não há recompensa liberável: no mock a indicação precisa estar aprovada/vendida.",
      }
    }
    return {
      ok: true,
      rewardId: `mock-reward-${referralId}`,
      transactionId: `mock-wt-${Date.now()}`,
      balanceAfter: indicacao.valorRecompensa,
    }
  },

  async getStats(indicadorId) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { indicacoes } = mockDataService.getSnapshot()
    let data = [...indicacoes]
    if (indicadorId) {
      data = data.filter((item) => item.indicadorId === indicadorId)
    }

    return {
      total: data.length,
      pendentes: data.filter((item) => item.status === "pendente").length,
      emAndamento: data.filter(
        (item) => item.status === "em_atendimento" || item.status === "em_negociacao"
      ).length,
      aprovadas: data.filter((item) => item.status === "aprovada" || item.status === "paga")
        .length,
      recusadas: data.filter((item) => item.status === "recusada").length,
    }
  },
}
