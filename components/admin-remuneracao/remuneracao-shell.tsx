import Link from "next/link"
import { redirect } from "next/navigation"
import { authorizeAdminRemuneracao } from "@/lib/admin-remuneracao/guard"
import { ADMIN_REMUNERACAO_SECTIONS } from "@/lib/admin-remuneracao/policy"
import { PageHeader } from "@/components/ui/page-header"

/** Guard server-side reutilizado por layout E por cada página (não confia só no layout/menu). */
export async function requireAdminRemuneracaoPage(): Promise<void> {
  const auth = await authorizeAdminRemuneracao()
  if (!auth.ok) redirect(auth.status === 401 ? "/login?redirect=/admin/remuneracao" : "/admin")
}

/**
 * Shell somente leitura (3.1F-J2): sem formulário, sem botão de ação, sem consulta
 * financeira, nenhum registro criado no load.
 * 3.1F-J4: seções com configuração em rascunho passam o conteúdo como `children`
 * (componentes isolados em components/compensation-config); o shell continua sem ação.
 */
export async function RemuneracaoShell({ sectionKey, children }: { sectionKey: string | null; children?: React.ReactNode }) {
  await requireAdminRemuneracaoPage()
  const current = ADMIN_REMUNERACAO_SECTIONS.find((s) => s.key === sectionKey) ?? null
  return (
    <div className="space-y-6">
      <PageHeader
        title={current ? current.title : "Remuneração de Funcionários"}
        description={current ? current.description : "Estrutura da remuneração da equipe. Separada do Financeiro — Indique e Ganhe."}
      />
      <nav aria-label="Seções de remuneração" className="flex flex-wrap gap-2">
        <Link
          href="/admin/remuneracao"
          aria-current={current ? undefined : "page"}
          className={`rounded-full border px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-primary ${current ? "border-border text-muted-foreground hover:text-foreground" : "border-primary/50 bg-primary/10 text-primary"}`}
        >
          Visão geral
        </Link>
        {ADMIN_REMUNERACAO_SECTIONS.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            aria-current={current?.key === s.key ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-primary ${current?.key === s.key ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {s.title}
          </Link>
        ))}
      </nav>
      {children ?? (
      <div role="status" className="rounded-xl border border-dashed border-border/60 bg-card/30 p-6 text-center">
        <p className="font-medium text-foreground">Nenhuma configuração criada</p>
        <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
          Esta área está em modo somente leitura. A configuração será liberada em etapa futura, após validação.
          Abrir esta página não cria nenhum registro.
        </p>
      </div>
      )}
      {!current ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ADMIN_REMUNERACAO_SECTIONS.map((s) => (
            <li key={s.key}>
              <Link href={s.href} className="block h-full rounded-xl border border-border/50 bg-card/50 p-4 hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-primary">
                <span className="block font-medium">{s.title}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{s.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
