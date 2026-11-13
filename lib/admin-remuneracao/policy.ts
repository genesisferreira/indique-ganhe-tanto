import type { UserRole } from "@/types/user"

/**
 * 3.1F-J2 — Remuneração de Funcionários (/admin/remuneracao/*).
 * Somente Admin Master e Admin Financeiro. admin_consulta NÃO acessa
 * (nem menu, nem página, nem API). Ser gestor de funcionário não concede acesso.
 */
export const ADMIN_REMUNERACAO_PREFIX = "/admin/remuneracao"
export const ADMIN_REMUNERACAO_API_PREFIX = "/api/admin/remuneracao"
export const ADMIN_REMUNERACAO_ROLES: readonly UserRole[] = ["admin_master", "admin_financeiro"]

export function canAccessAdminRemuneracao(role: UserRole | string | null | undefined): boolean {
  return role === "admin_master" || role === "admin_financeiro"
}

export function isAdminRemuneracaoPath(pathname: string): boolean {
  return (
    pathname === ADMIN_REMUNERACAO_PREFIX ||
    pathname.startsWith(`${ADMIN_REMUNERACAO_PREFIX}/`) ||
    pathname === ADMIN_REMUNERACAO_API_PREFIX ||
    pathname.startsWith(`${ADMIN_REMUNERACAO_API_PREFIX}/`)
  )
}

export type AdminRemuneracaoSection = {
  key: string
  href: string
  title: string
  description: string
}

/** Estrutura navegável. 3.1F-J4: regras e perfis aceitam configuração em RASCUNHO; demais seções seguem somente leitura. */
export const ADMIN_REMUNERACAO_SECTIONS: readonly AdminRemuneracaoSection[] = [
  { key: "regras", href: "/admin/remuneracao/regras", title: "Regras de comissão", description: "Revisão, aprovação e ativação. Modalidades só ativam com prova financeira." },
  { key: "funcionarios", href: "/admin/remuneracao/funcionarios", title: "Perfis de remuneração", description: "Salário, vale-refeição, passagem e combustível por funcionário (rascunho e aprovação)." },
  { key: "dias-trabalhados", href: "/admin/remuneracao/dias-trabalhados", title: "Dias trabalhados", description: "Registro mensal de presença da competência." },
  { key: "competencias", href: "/admin/remuneracao/competencias", title: "Competências", description: "Cálculo, fechamento e registro manual de pagamento da folha." },
  { key: "comissao", href: "/admin/remuneracao/comissao", title: "Comissões", description: "Reconciliação controlada e direitos apurados. Sem ERP automático." },
  { key: "auditoria", href: "/admin/remuneracao/auditoria", title: "Auditoria financeira", description: "Eventos financeiros append-only." },
]
