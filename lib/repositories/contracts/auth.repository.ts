import type { LoginCredentials, RegisterData, User } from "@/types"

export interface AuthResponse {
  success: boolean
  user?: User
  error?: string
}

export interface AuthRepository {
  login(credentials: LoginCredentials): Promise<AuthResponse>
  register(data: RegisterData): Promise<AuthResponse>
  logout(): Promise<void>
  getCurrentUser(): Promise<User | null>
  resetPassword(email: string): Promise<{ success: boolean; error?: string }>
  updatePassword(newPassword: string): Promise<{ success: boolean; error?: string }>
}
