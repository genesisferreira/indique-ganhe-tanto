import type { UserRole } from "@/types/user"

/** Perfil autenticado (`public.profiles` + sessão) para shell e páginas. */
export type AuthProfileBasics = {
  id: string
  fullName: string
  email: string
  phone: string
  role: UserRole
  avatarUrl: string | null
  /** ISO string `profiles.created_at` */
  createdAt: string | null
}
