import { RemuneracaoShell, requireAdminRemuneracaoPage } from "@/components/admin-remuneracao/remuneracao-shell"
import { ConfigLoadError } from "@/components/compensation-config/ui"
import { CompetenceBoard } from "@/components/payroll-competence/competence-board"
import { isUuid, todaySaoPaulo } from "@/lib/compensation-config/contract"
import { isMonthStart, monthStart } from "@/lib/payroll-competence/contract"
import { loadCompensationEmployees } from "@/lib/compensation-config/service"
import { loadCompetenceDetail, loadCompetenceList } from "@/lib/payroll-competence/service"

export const dynamic = "force-dynamic"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminRemuneracaoPage()
  const sp = await searchParams
  const rawEmp = typeof sp.funcionario === "string" ? sp.funcionario : null
  const employeeId = rawEmp && isUuid(rawEmp) ? rawEmp : null
  const rawMonth = typeof sp.competencia === "string" ? sp.competencia : null
  const month = rawMonth && isMonthStart(rawMonth) ? rawMonth : monthStart(todaySaoPaulo())
  const rawId = typeof sp.id === "string" ? sp.id : null
  const competenceId = rawId && isUuid(rawId) ? rawId : null
  const list = await loadCompensationEmployees()
  const comps = await loadCompetenceList(employeeId, month)
  const detail = competenceId ? await loadCompetenceDetail(competenceId) : null
  return (
    <RemuneracaoShell sectionKey="competencias">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Apuração mensal com snapshot do perfil aprovado. Comissão não é calculada. Fechamento não registra pagamento.</p>
        {!list.ok ? (
          <ConfigLoadError kind={list.kind} />
        ) : !comps.ok ? (
          <ConfigLoadError kind={comps.kind} />
        ) : detail && !detail.ok ? (
          <>
            <CompetenceBoard employees={list.data} items={comps.data.items} detail={null} employeeId={employeeId} month={month} />
            <ConfigLoadError kind={detail.kind} />
          </>
        ) : (
          <CompetenceBoard employees={list.data} items={comps.data.items} detail={detail && detail.ok ? detail.data : null} employeeId={employeeId} month={month} />
        )}
      </div>
    </RemuneracaoShell>
  )
}
