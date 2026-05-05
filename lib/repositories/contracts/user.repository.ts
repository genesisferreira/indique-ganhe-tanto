import type { Comercial, Indicador, ProfileUpdateData, User, UserRole } from "@/types"

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface UserRepository {
  getById(id: string): Promise<User | null>
  getByRole(role: UserRole, page?: number, pageSize?: number): Promise<PaginatedResponse<User>>
  getIndicadores(page?: number, pageSize?: number): Promise<PaginatedResponse<Indicador>>
  getComerciais(page?: number, pageSize?: number): Promise<PaginatedResponse<Comercial>>
  updateProfile(userId: string, data: ProfileUpdateData): Promise<User | null>
  setActive(userId: string, active: boolean): Promise<boolean>
  search(query: string, role?: UserRole): Promise<User[]>
}
