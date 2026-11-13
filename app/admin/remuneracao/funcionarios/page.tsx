import { RemuneracaoShell, requireAdminRemuneracaoPage } from "@/components/admin-remuneracao/remuneracao-shell"
import { EmployeeCompensationConfigurator } from "@/components/compensation-config/employee-compensation-configurator"
import { ConfigLoadError, DraftBanners } from "@/components/compensation-config/ui"
import { isUuid, todaySaoPaulo } from "@/lib/compensation-config/contract"
import { loadCompensationEmployees, loadEmployeeCompensationDetail } from "@/lib/compensation-config/service"

export const dynamic = "force-dynamic"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** 3.1F-J4: remuneração individual em rascunho (Admin Master / Admin Financeiro). Guard antes de qualquer leitura. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminRemuneracaoPage()
  const sp = await searchParams
  const raw = typeof sp.funcionario === "string" ? sp.funcionario : null
  const selected = raw && isUuid(raw) ? raw : null
  const list = await loadCompensationEmployees()
  const detail = list.ok && selected ? await loadEmployeeCompensationDetail(selected) : null
  return (
    <RemuneracaoShell sectionKey="funcionarios">
      <div className="space-y-6">
        <DraftBanners />
        {!list.ok ? (
          <ConfigLoadError kind={list.kind} />
        ) : detail && !detail.ok ? (
          <>
            <EmployeeCompensationConfigurator employees={list.data} detail={null} today={todaySaoPaulo()} />
            <ConfigLoadError kind={detail.kind} />
          </>
        ) : (
          <EmployeeCompensationConfigurator employees={list.data} detail={detail && detail.ok ? detail.data : null} today={todaySaoPaulo()} />
        )}
      </div>
    </RemuneracaoShell>
  )
}
