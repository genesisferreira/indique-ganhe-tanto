import type { LoginCredentials, RegisterData, User, UserRole } from '@/types'
// import { createClient } from '@/lib/supabase/client'
import { authRepository } from '@/lib/repositories'
import type { AuthResponse } from '@/lib/repositories/contracts/auth.repository'

export const authService = {
  /**
   * Login with email and password
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    return authRepository.login(credentials)
  },

  /**
   * Register a new user (indicador)
   */
  async register(data: RegisterData): Promise<AuthResponse> {
    return authRepository.register(data)
  },

  /**
   * Logout current user
   */
  async logout(): Promise<void> {
    return authRepository.logout()
  },

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<User | null> {
    return authRepository.getCurrentUser()
  },

  /**
   * Send password reset email
   */
  async resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
    return authRepository.resetPassword(email)
  },

  /**
   * Update password
   */
  async updatePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
    return authRepository.updatePassword(newPassword)
  },

  /**
   * Check if user has required role
   */
  hasRole(user: User | null, roles: UserRole[]): boolean {
    if (!user) return false
    return roles.includes(user.role)
  },

  /**
   * Check if user is admin (any level)
   */
  isAdmin(user: User | null): boolean {
    if (!user) return false
    return ['admin_consulta', 'admin_financeiro', 'admin_master'].includes(user.role)
  },
}
