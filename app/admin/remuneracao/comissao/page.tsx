import { RemuneracaoShell, requireAdminRemuneracaoPage } from "@/components/admin-remuneracao/remuneracao-shell"
import { CommissionReconcileBoard } from "@/components/commission-activation/reconcile-board"
import { loadCommissionEntitlements } from "@/lib/commission-activation/service"

export const dynamic = "force-dynamic"

export default async function Page() {
  await requireAdminRemuneracaoPage()
  const entitlements = await loadCommissionEntitlements()
  return (
    <RemuneracaoShell sectionKey="comissao">
      <CommissionReconcileBoard raw={entitlements} />
    </RemuneracaoShell>
  )
}
