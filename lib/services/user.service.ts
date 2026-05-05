import type { User, UserRole, ProfileUpdateData, Indicador, Comercial, Admin } from '@/types'
// import { createClient } from '@/lib/supabase/client'
import { userRepository } from '@/lib/repositories'
import type { PaginatedResponse } from '@/lib/repositories/contracts/user.repository'

export const userService = {
  /**
   * Get user by ID
   */
  async getById(id: string): Promise<User | null> {
    return userRepository.getById(id)
  },

  /**
   * Get all users by role
   */
  async getByRole(role: UserRole, page = 1, pageSize = 10): Promise<PaginatedResponse<User>> {
    return userRepository.getByRole(role, page, pageSize)
  },

  /**
   * Get all indicadores
   */
  async getIndicadores(page = 1, pageSize = 10): Promise<PaginatedResponse<Indicador>> {
    return userRepository.getIndicadores(page, pageSize)
  },

  /**
   * Get all comerciais
   */
  async getComerciais(page = 1, pageSize = 10): Promise<PaginatedResponse<Comercial>> {
    return userRepository.getComerciais(page, pageSize)
  },

  /**
   * Update user profile
   */
  async updateProfile(userId: string, data: ProfileUpdateData): Promise<User | null> {
    return userRepository.updateProfile(userId, data)
  },

  /**
   * Activate/Deactivate user
   */
  async setActive(userId: string, active: boolean): Promise<boolean> {
    return userRepository.setActive(userId, active)
  },

  /**
   * Search users
   */
  async search(query: string, role?: UserRole): Promise<User[]> {
    return userRepository.search(query, role)
  },
}
