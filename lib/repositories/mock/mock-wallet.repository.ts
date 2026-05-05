import type { WalletRepository } from "@/lib/repositories/contracts/wallet.repository"
import type { Transacao } from "@/types"

export const mockWalletRepository: WalletRepository = {
  async getByIndicador(indicadorId) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return {
      id: `cart-${indicadorId}`,
      indicadorId,
      saldoDisponivel: 299.7,
      saldoPendente: 329.7,
      saldoEmDesconto: 99.9,
      totalRecebido: 1798.2,
      updatedAt: new Date(),
    }
  },

  async getSummary() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return {
      saldoDisponivel: 299.7,
      saldoPendente: 329.7,
      saldoEmDesconto: 99.9,
      totalRecebido: 1798.2,
      ultimaTransacao: new Date(),
    }
  },

  async getExtrato(indicadorId, filters = {}, page = 1, pageSize = 10) {
    await new Promise((resolve) => setTimeout(resolve, 200))

    const mockTransacoes: Transacao[] = [
      {
        id: "trans-001",
        carteiraId: `cart-${indicadorId}`,
        indicadorId,
        tipo: "credito",
        valor: 129.9,
        saldoAnterior: 169.8,
        saldoPosterior: 299.7,
        descricao: "Recompensa - Indicação #ind-001",
        referencia: "ind-001",
        createdAt: new Date("2024-03-30"),
      },
      {
        id: "trans-002",
        carteiraId: `cart-${indicadorId}`,
        indicadorId,
        tipo: "saque",
        valor: 100,
        saldoAnterior: 269.8,
        saldoPosterior: 169.8,
        descricao: "Saque via PIX",
        createdAt: new Date("2024-03-25"),
      },
    ]

    let data = [...mockTransacoes]
    if (filters.tipo && filters.tipo !== "todos") {
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

  async addCredit(indicadorId, valor, descricao, referencia) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return {
      id: `trans-${Date.now()}`,
      carteiraId: `cart-${indicadorId}`,
      indicadorId,
      tipo: "credito",
      valor,
      saldoAnterior: 0,
      saldoPosterior: valor,
      descricao,
      referencia,
      createdAt: new Date(),
    }
  },

  async processWithdrawal(indicadorId, valor) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const wallet = await this.getByIndicador(indicadorId)
    if (!wallet || wallet.saldoDisponivel < valor) {
      return { success: false, error: "Saldo insuficiente" }
    }
    return { success: true }
  },

  async applyDiscount() {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return { success: true }
  },
}
