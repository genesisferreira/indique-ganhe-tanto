import type { AuthRepository } from "@/lib/repositories/contracts/auth.repository"
import type { LoginCredentials, RegisterData, UserRole } from "@/types"
import { mockDataService } from "@/lib/services/mock-data.service"

export const mockAuthRepository: AuthRepository = {
  async login(credentials: LoginCredentials) {
    await new Promise((resolve) => setTimeout(resolve, 500))

    const { indicadores, comerciais, admins } = mockDataService.getSnapshot()
    const allUsers = [...indicadores, ...comerciais, ...admins]
    const user = allUsers.find((item) => item.email === credentials.email)

    if (!user) {
      return { success: false, error: "Credenciais inválidas" }
    }

    return { success: true, user }
  },

  async register(data: RegisterData) {
    await new Promise((resolve) => setTimeout(resolve, 500))

    return {
      success: true,
      user: {
        id: `ind-${Date.now()}`,
        nome: data.nome,
        email: data.email,
        telefone: data.telefone,
        role: "indicador" as UserRole,
        ativo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }
  },

  async logout() {
    await new Promise((resolve) => setTimeout(resolve, 200))
  },

  async getCurrentUser() {
    return null
  },

  async resetPassword() {
    await new Promise((resolve) => setTimeout(resolve, 500))
    return { success: true }
  },

  async updatePassword() {
    await new Promise((resolve) => setTimeout(resolve, 500))
    return { success: true }
  },
}
