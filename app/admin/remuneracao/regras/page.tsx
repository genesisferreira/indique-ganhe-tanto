import { RemuneracaoShell, requireAdminRemuneracaoPage } from "@/components/admin-remuneracao/remuneracao-shell"
import { RulesConfigurator } from "@/components/compensation-config/rules-configurator"
import { ConfigLoadError, DraftBanners } from "@/components/compensation-config/ui"
import { todaySaoPaulo } from "@/lib/compensation-config/contract"
import { loadCommissionRules } from "@/lib/compensation-config/service"

export const dynamic = "force-dynamic"

/** 3.1F-J4: regras de comissão em rascunho (Admin Master / Admin Financeiro). Guard antes de qualquer leitura. */
export default async function Page() {
  await requireAdminRemuneracaoPage()
  const r = await loadCommissionRules()
  return (
    <RemuneracaoShell sectionKey="regras">
      <div className="space-y-6">
        <DraftBanners />
        {r.ok ? <RulesConfigurator families={r.data.families} today={todaySaoPaulo()} /> : <ConfigLoadError kind={r.kind} />}
      </div>
    </RemuneracaoShell>
  )
}
