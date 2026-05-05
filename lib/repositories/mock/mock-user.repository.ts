import type { UserRepository } from "@/lib/repositories/contracts/user.repository"
import type { User, UserRole } from "@/types"
import { mockDataService } from "@/lib/services/mock-data.service"

export const mockUserRepository: UserRepository = {
  async getById(id) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { indicadores, comerciais, admins } = mockDataService.getSnapshot()
    const allUsers = [...indicadores, ...comerciais, ...admins]
    return allUsers.find((item) => item.id === id) || null
  },

  async getByRole(role, page = 1, pageSize = 10) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { indicadores, comerciais, admins } = mockDataService.getSnapshot()

    let users: User[] = []
    switch (role) {
      case "indicador":
        users = indicadores
        break
      case "comercial":
        users = comerciais
        break
      default:
        users = admins.filter((item) => item.role === role)
        break
    }

    const total = users.length
    const start = (page - 1) * pageSize
    const data = users.slice(start, start + pageSize)

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  },

  async getIndicadores(page = 1, pageSize = 10) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { indicadores } = mockDataService.getSnapshot()

    const total = indicadores.length
    const start = (page - 1) * pageSize
    const data = indicadores.slice(start, start + pageSize)

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  },

  async getComerciais(page = 1, pageSize = 10) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { comerciais } = mockDataService.getSnapshot()

    const total = comerciais.length
    const start = (page - 1) * pageSize
    const data = comerciais.slice(start, start + pageSize)

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  },

  async updateProfile(userId, data) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const user = await this.getById(userId)
    if (!user) return null
    return { ...user, ...data, updatedAt: new Date() }
  },

  async setActive() {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return true
  },

  async search(query, role?: UserRole) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { indicadores, comerciais, admins } = mockDataService.getSnapshot()
    let users: User[] = [...indicadores, ...comerciais, ...admins]

    if (role) {
      users = users.filter((item) => item.role === role)
    }

    const lowerQuery = query.toLowerCase()
    return users.filter(
      (item) =>
        item.nome.toLowerCase().includes(lowerQuery) ||
        item.email.toLowerCase().includes(lowerQuery)
    )
  },
}
