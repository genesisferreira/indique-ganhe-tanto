export type UserRole = 'indicador' | 'comercial' | 'admin_consulta' | 'admin_financeiro' | 'admin_master'

export interface User {
  id: string
  nome: string
  email: string
  telefone: string
  role: UserRole
  avatar?: string
  ativo?: boolean
  createdAt: Date
  updatedAt?: Date
}

export interface UserSession {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface RegisterData {
  nome: string
  email: string
  telefone: string
  password: string
  cpf?: string
}
