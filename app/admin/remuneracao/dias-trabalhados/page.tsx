import { RemuneracaoShell, requireAdminRemuneracaoPage } from "@/components/admin-remuneracao/remuneracao-shell"
import { ConfigLoadError } from "@/components/compensation-config/ui"
import { WorkedDaysBoard } from "@/components/payroll-competence/worked-days-board"
import { isUuid, todaySaoPaulo } from "@/lib/compensation-config/contract"
import { isMonthStart, monthStart } from "@/lib/payroll-competence/contract"
import { loadCompensationEmployees } from "@/lib/compensation-config/service"
import { loadWorkedDays } from "@/lib/payroll-competence/service"

export const dynamic = "force-dynamic"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminRemuneracaoPage()
  const sp = await searchParams
  const rawEmp = typeof sp.funcionario === "string" ? sp.funcionario : null
  const employeeId = rawEmp && isUuid(rawEmp) ? rawEmp : null
  const rawMonth = typeof sp.competencia === "string" ? sp.competencia : null
  const month = rawMonth && isMonthStart(rawMonth) ? rawMonth : monthStart(todaySaoPaulo())
  const list = await loadCompensationEmployees()
  const days = list.ok && employeeId ? await loadWorkedDays(employeeId, month) : null
  return (
    <RemuneracaoShell sectionKey="dias-trabalhados">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Registro de presença da competência. O funcionário não altera os próprios dias. Nenhuma comissão ou pagamento é gerado.</p>
        {!list.ok ? (
          <ConfigLoadError kind={list.kind} />
        ) : days && !days.ok ? (
          <>
            <WorkedDaysBoard employees={list.data} view={null} employeeId={employeeId} month={month} />
            <ConfigLoadError kind={days.kind} />
          </>
        ) : (
          <WorkedDaysBoard employees={list.data} view={days && days.ok ? days.data : null} employeeId={employeeId} month={month} />
        )}
      </div>
    </RemuneracaoShell>
  )
}
