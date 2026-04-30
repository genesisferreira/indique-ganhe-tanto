import type { User, UserRole, ProfileUpdateData, Indicador, Comercial, Admin } from '@/types'
// import { createClient } from '@/lib/supabase/client'

// Mock implementation
import { indicadores, comerciais, admins } from '@/lib/mock/users'

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export const userService = {
  /**
   * Get user by ID
   */
  async getById(id: string): Promise<User | null> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

    const allUsers = [...indicadores, ...comerciais, ...admins]
    return allUsers.find(u => u.id === id) || null
  },

  /**
   * Get all users by role
   */
  async getByRole(role: UserRole, page = 1, pageSize = 10): Promise<PaginatedResponse<User>> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

    let users: User[] = []
    switch (role) {
      case 'indicador':
        users = indicadores
        break
      case 'comercial':
        users = comerciais
        break
      default:
        users = admins.filter(a => a.role === role)
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

  /**
   * Get all indicadores
   */
  async getIndicadores(page = 1, pageSize = 10): Promise<PaginatedResponse<Indicador>> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

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

  /**
   * Get all comerciais
   */
  async getComerciais(page = 1, pageSize = 10): Promise<PaginatedResponse<Comercial>> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

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

  /**
   * Update user profile
   */
  async updateProfile(userId: string, data: ProfileUpdateData): Promise<User | null> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 300))

    // Mock implementation - just returns success
    const user = await this.getById(userId)
    if (!user) return null

    return { ...user, ...data, updatedAt: new Date() }
  },

  /**
   * Activate/Deactivate user
   */
  async setActive(userId: string, active: boolean): Promise<boolean> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))
    return true
  },

  /**
   * Search users
   */
  async search(query: string, role?: UserRole): Promise<User[]> {
    // TODO: Replace with Supabase query
    await new Promise(resolve => setTimeout(resolve, 200))

    let users: User[] = [...indicadores, ...comerciais, ...admins]
    
    if (role) {
      users = users.filter(u => u.role === role)
    }

    const lowerQuery = query.toLowerCase()
    return users.filter(u => 
      u.nome.toLowerCase().includes(lowerQuery) ||
      u.email.toLowerCase().includes(lowerQuery)
    )
  },
}
