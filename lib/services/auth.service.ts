import type { LoginCredentials, RegisterData, User, UserRole } from '@/types'
// import { createClient } from '@/lib/supabase/client'

// Mock implementation - replace with Supabase when ready
import { indicadores, comerciais, admins } from '@/lib/mock/users'

export interface AuthResponse {
  success: boolean
  user?: User
  error?: string
}

export const authService = {
  /**
   * Login with email and password
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    // TODO: Replace with Supabase auth
    // const supabase = createClient()
    // const { data, error } = await supabase.auth.signInWithPassword(credentials)

    // Mock implementation
    await new Promise(resolve => setTimeout(resolve, 500))

    const allUsers = [...indicadores, ...comerciais, ...admins]
    const user = allUsers.find(u => u.email === credentials.email)

    if (!user) {
      return { success: false, error: 'Credenciais inválidas' }
    }

    return { success: true, user }
  },

  /**
   * Register a new user (indicador)
   */
  async register(data: RegisterData): Promise<AuthResponse> {
    // TODO: Replace with Supabase auth
    // const supabase = createClient()
    // const { data: authData, error } = await supabase.auth.signUp({
    //   email: data.email,
    //   password: data.password,
    //   options: { data: { nome: data.nome, telefone: data.telefone } }
    // })

    // Mock implementation
    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      success: true,
      user: {
        id: `ind-${Date.now()}`,
        nome: data.nome,
        email: data.email,
        telefone: data.telefone,
        role: 'indicador' as UserRole,
        ativo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    }
  },

  /**
   * Logout current user
   */
  async logout(): Promise<void> {
    // TODO: Replace with Supabase auth
    // const supabase = createClient()
    // await supabase.auth.signOut()

    // Mock implementation
    await new Promise(resolve => setTimeout(resolve, 200))
  },

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<User | null> {
    // TODO: Replace with Supabase auth
    // const supabase = createClient()
    // const { data: { user } } = await supabase.auth.getUser()

    // Mock implementation - returns null (not logged in)
    return null
  },

  /**
   * Send password reset email
   */
  async resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
    // TODO: Replace with Supabase auth
    // const supabase = createClient()
    // const { error } = await supabase.auth.resetPasswordForEmail(email)

    // Mock implementation
    await new Promise(resolve => setTimeout(resolve, 500))

    return { success: true }
  },

  /**
   * Update password
   */
  async updatePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
    // TODO: Replace with Supabase auth
    // const supabase = createClient()
    // const { error } = await supabase.auth.updateUser({ password: newPassword })

    // Mock implementation
    await new Promise(resolve => setTimeout(resolve, 500))

    return { success: true }
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
