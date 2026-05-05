import type { PaymentRepository } from "@/lib/repositories/contracts/payment.repository"
import { mockDataService } from "@/lib/services/mock-data.service"

export const mockPaymentRepository: PaymentRepository = {
  async getAll(filters = {}, page = 1, pageSize = 10) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { pagamentos } = mockDataService.getSnapshot()
    let data = [...pagamentos]

    if (filters.status && filters.status !== "todos") {
      data = data.filter((item) => item.status === filters.status)
    }
    if (filters.indicadorId) {
      data = data.filter((item) => item.indicadorId === filters.indicadorId)
    }
    if (filters.tipo) {
      data = data.filter((item) => item.tipo === filters.tipo)
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

  async getById(id) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { pagamentos } = mockDataService.getSnapshot()
    return pagamentos.find((item) => item.id === id) || null
  },

  async getByIndicador(indicadorId, page = 1, pageSize = 10) {
    return this.getAll({ indicadorId }, page, pageSize)
  },

  async create(data) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return {
      id: `pag-${Date.now()}`,
      ...data,
      status: "pendente",
      dataVencimento: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  },

  async updateStatus() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return true
  },

  async approve() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return true
  },

  async markAsPaid() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return true
  },

  async requestWithdrawal(indicadorId, valor, chavePix, tipoChavePix) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return {
      id: `saque-${Date.now()}`,
      indicadorId,
      valor,
      chavePix,
      tipoChavePix,
      status: "pendente",
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  },

  async getPendingSummary() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { pagamentos } = mockDataService.getSnapshot()
    const pendentes = pagamentos.filter((item) => item.status === "pendente")
    const aprovados = pagamentos.filter((item) => item.status === "aprovado")

    return {
      totalPendente: pendentes.reduce((sum, item) => sum + item.valor, 0),
      quantidadePendente: pendentes.length,
      totalAprovado: aprovados.reduce((sum, item) => sum + item.valor, 0),
      quantidadeAprovado: aprovados.length,
    }
  },
}
