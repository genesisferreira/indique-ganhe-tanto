import { requireAdminRemuneracaoPage } from "@/components/admin-remuneracao/remuneracao-shell"

export const dynamic = "force-dynamic"

/** 3.1F-J2: Admin Master / Admin Financeiro somente. admin_consulta => redirect. */
export default async function AdminRemuneracaoLayout({ children }: { children: React.ReactNode }) {
  await requireAdminRemuneracaoPage()
  return <>{children}</>
}
